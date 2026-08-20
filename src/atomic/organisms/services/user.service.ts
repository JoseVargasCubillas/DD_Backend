import { User, IUserDocument } from '../../molecules/models/user.model.js';
import { Tag, ITagDocument } from '../../molecules/models/tag.model.js';
import { Order, IOrderDocument } from '../../molecules/models/order.model.js';
import { Course } from '../../molecules/models/course.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';
import { hashPassword } from '../../atoms/helpers/hash.helper.js';
import { env } from '../../../config/env.js';
import { getEffectiveUserCourses, getUserOffers } from './offer.service.js';
import { sendCredentials } from './email.service.js';
import { enqueueMigrationWelcome } from './email-queue.service.js';

const makeError = (message: string, statusCode: number): Error =>
  Object.assign(new Error(message), { statusCode });

interface ListParams { page?: number; limit?: number; search?: string; tagId?: string; role?: string; sort?: string; segment?: string }
export interface ImportContactInput {
  name: string;
  email: string;
  phone?: string;
  products?: string[];
  tags?: string[];
  createdAt?: string;
  signInCount?: number;
  lastLogin?: string;
  sourceId?: string;
}

export interface ImportContactsInput {
  contacts: ImportContactInput[];
  productMappings: Record<string, string[]>;
  sendMigrationEmail?: boolean;
}

interface ImportResultRow {
  email: string;
  name: string;
  status: 'created' | 'updated' | 'skipped';
  userId?: string;
  tempPassword?: string;
  products: string[];
  courseIds: string[];
  unmatchedProducts: string[];
  reason?: string;
}

const sanitize = (u: IUserDocument): any => {
  const { password: _p, resetPasswordToken: _r, emailVerifyToken: _e, ...rest } = u as any;
  return rest;
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const slugifySegment = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const getOrCreateProductTag = async (productName: string): Promise<string> => {
  const name = `Kajabi: ${productName}`.slice(0, 120);
  const slug = `kajabi-${slugifySegment(productName) || 'producto'}`;
  const existing = await Tag.findOne({ slug });
  if (existing) return existing._id;

  const tag = await Tag.create({
    name,
    slug,
    color: '#1f2937',
    description: 'Segmento importado desde productos de Kajabi.',
  });
  return tag._id;
};

export const getById = async (id: string): Promise<IUserDocument> => {
  const user = await User.findById(id).populate('enrolledCourses', 'title slug thumbnail category shortDescription');
  if (!user) throw makeError('User not found', 404);
  return user;
};

export const getByIdSanitized = async (id: string) => {
  const user = await getById(id);
  const [effectiveCourses, offers] = await Promise.all([
    getEffectiveUserCourses(id).catch(() => []),
    getUserOffers(id).catch(() => []),
  ]);
  return {
    ...sanitize(user),
    enrolledCourses: effectiveCourses,
    assignedOffers: offers,
  };
};

export const updateProfile = async (id: string, data: Partial<IUserDocument>): Promise<IUserDocument | null> => {
  const allowed: (keyof IUserDocument)[] = ['name', 'phone', 'bio', 'avatar'] as any;
  const updates = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k as any)));
  return User.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

export const adminUpdateUser = async (id: string, data: Partial<IUserDocument>) => {
  const allowed = ['name', 'email', 'phone', 'bio', 'avatar', 'role', 'plan', 'isActive', 'notes', 'contactStatus', 'marketingStatus'];
  const updates = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  const user = await User.findByIdAndUpdate(id, updates, { new: true });
  if (!user) throw makeError('User not found', 404);
  return sanitize(user);
};

export const listUsers = async ({ page = 1, limit = 20, search = '', tagId, role, sort = 'added_newest', segment = '' }: ListParams) => {
  const all = await User.find({});

  let filtered = all;
  if (role) filtered = filtered.filter((u) => u.role === role);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (u) => (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q),
    );
  }
  if (tagId) {
    filtered = filtered.filter((u) => Array.isArray(u.tagIds) && u.tagIds.includes(tagId));
  }
  if (segment === 'customers') {
    filtered = filtered.filter((u) => u.contactStatus === 'customer');
  }
  if (segment === 'subscribed') {
    filtered = filtered.filter((u) => u.marketingStatus === 'subscribed');
  }
  if (segment === 'inactive') {
    filtered = filtered.filter((u) => !u.isActive || u.contactStatus === 'churned');
  }
  if (segment === 'hard_bounced') {
    filtered = [];
  }

  filtered.sort((a, b) => {
    const byText = (left = '', right = '') => left.localeCompare(right, 'es', { sensitivity: 'base' });
    const byDate = (left?: Date | string, right?: Date | string) =>
      new Date(String(left ?? 0)).getTime() - new Date(String(right ?? 0)).getTime();

    switch (sort) {
      case 'name_asc':
        return byText(a.name, b.name);
      case 'name_desc':
        return byText(b.name, a.name);
      case 'email_asc':
        return byText(a.email, b.email);
      case 'email_desc':
        return byText(b.email, a.email);
      case 'lifetime_most':
      case 'lifetime_least':
        return 0;
      case 'added_oldest':
        return byDate(a.createdAt, b.createdAt);
      case 'last_activity_oldest':
        return byDate(a.lastLogin, b.lastLogin);
      case 'last_activity_newest':
        return byDate(b.lastLogin, a.lastLogin);
      case 'added_newest':
      default:
        return byDate(b.createdAt, a.createdAt);
    }
  });

  const total = filtered.length;
  const sliced = filtered.slice((page - 1) * limit, page * limit).map(sanitize);
  return { users: sliced, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
};

export const importContacts = async ({ contacts, productMappings, sendMigrationEmail = false }: ImportContactsInput) => {
  if (!Array.isArray(contacts) || contacts.length === 0) throw makeError('No hay contactos para importar', 400);
  if (contacts.length > 5000) throw makeError('Importa máximo 5000 contactos por archivo', 400);

  const courses = await Course.find({});
  const validCourseIds = new Set(courses.map((course) => String(course._id)));
  const results: ImportResultRow[] = [];
  const seenEmails = new Set<string>();

  for (const contact of contacts) {
    const email = normalizeEmail(contact.email || '');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      results.push({
        email: contact.email || '',
        name: contact.name || '',
        status: 'skipped',
        products: contact.products ?? [],
        courseIds: [],
        unmatchedProducts: contact.products ?? [],
        reason: 'Email inválido',
      });
      continue;
    }

    if (seenEmails.has(email)) {
      results.push({
        email,
        name: contact.name || email,
        status: 'skipped',
        products: contact.products ?? [],
        courseIds: [],
        unmatchedProducts: [],
        reason: 'Duplicado dentro del archivo',
      });
      continue;
    }
    seenEmails.add(email);

    const products = Array.from(new Set((contact.products ?? []).map((p) => p.trim()).filter(Boolean)));
    const mappedCourseIds = Array.from(
      new Set(
        products.flatMap((product) => productMappings?.[product] ?? []).filter((courseId) => validCourseIds.has(courseId)),
      ),
    );
    const unmatchedProducts = products.filter((product) => !(productMappings?.[product] ?? []).some((courseId) => validCourseIds.has(courseId)));
    const tagIds = await Promise.all(products.map(getOrCreateProductTag));

    let user = await User.findOne({ email }).select('+password');
    let status: ImportResultRow['status'] = 'updated';
    let tempPassword: string | undefined;
    const previousCourseIds = new Set(user?.enrolledCourses ?? []);

    if (!user) {
      status = 'created';
      tempPassword = generateTempPassword();
      user = await User.create({
        name: contact.name || email.split('@')[0],
        email,
        password: await hashPassword(tempPassword),
        role: 'user',
        phone: contact.phone ?? '',
        enrolledCourses: mappedCourseIds,
        tagIds,
        contactStatus: products.length ? 'customer' : 'lead',
        marketingStatus: products.length ? 'subscribed' : 'never_subscribed',
        signInCount: Number(contact.signInCount ?? 0),
        lastLogin: contact.lastLogin || undefined,
        isActive: true,
        isEmailVerified: true,
        notes: sendMigrationEmail
          ? (contact.sourceId ? `Migrado desde plataforma anterior. ID: ${contact.sourceId}` : 'Migrado desde plataforma anterior.')
          : (contact.sourceId ? `Importado desde Kajabi. ID: ${contact.sourceId}` : 'Importado desde Kajabi.'),
        createdAt: contact.createdAt || undefined,
      } as any);

      if (sendMigrationEmail) {
        try {
          await enqueueMigrationWelcome({ name: user.name, email: user.email, tempPassword });
        } catch (err) {
          console.warn('[migrateContacts] failed to enqueue email for', email, (err as Error).message);
        }
      }
    } else {
      const nextCourses = new Set([...(user.enrolledCourses ?? []), ...mappedCourseIds]);
      const nextTags = new Set([...(user.tagIds ?? []), ...tagIds]);
      user.name = contact.name || user.name;
      user.phone = contact.phone || user.phone;
      user.enrolledCourses = Array.from(nextCourses);
      user.tagIds = Array.from(nextTags);
      user.contactStatus = products.length ? 'customer' : user.contactStatus;
      user.marketingStatus = products.length ? 'subscribed' : user.marketingStatus;
      user.signInCount = Math.max(Number(user.signInCount ?? 0), Number(contact.signInCount ?? 0));
      if (contact.lastLogin) user.lastLogin = contact.lastLogin;
      user.isActive = true;
      user.isEmailVerified = true;
      await user.save();
    }

    for (const courseId of mappedCourseIds) {
      if (previousCourseIds.has(courseId)) continue;
      const course = await Course.findById(courseId);
      if (!course) continue;
      course.enrolledCount = Number(course.enrolledCount ?? 0) + 1;
      await course.save();
    }

    for (const product of products) {
      const exists = await Subscription.findOne({ user: user._id, plan: product, status: 'active' });
      if (exists) continue;
      await Subscription.create({
        user: user._id,
        plan: product,
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 100 * 365 * 86400000).toISOString(),
        cancelAtPeriodEnd: false,
      } as any);
    }

    results.push({
      email,
      name: user.name,
      status,
      userId: user._id,
      tempPassword: env.nodeEnv === 'development' ? tempPassword : undefined,
      products,
      courseIds: mappedCourseIds,
      unmatchedProducts,
    });
  }

  const created = results.filter((row) => row.status === 'created').length;
  const updated = results.filter((row) => row.status === 'updated').length;
  const skipped = results.filter((row) => row.status === 'skipped').length;
  const unmatchedProducts = Array.from(new Set(results.flatMap((row) => row.unmatchedProducts)));

  return {
    summary: {
      total: contacts.length,
      created,
      updated,
      skipped,
      products: Array.from(new Set(results.flatMap((row) => row.products))).length,
      unmatchedProducts,
    },
    results,
  };
};

export const toggleActive = async (id: string): Promise<IUserDocument> => {
  const user = await User.findById(id);
  if (!user) throw makeError('User not found', 404);
  user.isActive = !user.isActive;
  return user.save();
};

export const deleteUser = async (id: string, requestingUserId: string): Promise<{ id: string }> => {
  const user = await User.findById(id);
  if (!user) throw makeError('User not found', 404);
  if (user.role === 'admin') throw makeError('No se puede eliminar una cuenta de administrador', 400);
  if (String(id) === String(requestingUserId)) throw makeError('No puedes eliminarte a ti mismo', 400);
  await User.findByIdAndDelete(id);
  return { id };
};

// ── Tags asignadas al usuario ────────────────────────────────
export const getUserTags = async (id: string): Promise<ITagDocument[]> => {
  const user = await User.findById(id);
  if (!user) throw makeError('User not found', 404);
  const ids = Array.isArray(user.tagIds) ? user.tagIds : [];
  const tags = await Promise.all(ids.map((tid) => Tag.findById(tid)));
  return tags.filter(Boolean) as ITagDocument[];
};

export const assignTag = async (userId: string, tagId: string) => {
  const user = await User.findById(userId);
  if (!user) throw makeError('User not found', 404);
  const tag = await Tag.findById(tagId);
  if (!tag) throw makeError('Tag not found', 404);
  const current = Array.isArray(user.tagIds) ? user.tagIds : [];
  if (!current.includes(tagId)) {
    user.tagIds = [...current, tagId];
    await user.save();
  }
  return getUserTags(userId);
};

export const removeTag = async (userId: string, tagId: string) => {
  const user = await User.findById(userId);
  if (!user) throw makeError('User not found', 404);
  const current = Array.isArray(user.tagIds) ? user.tagIds : [];
  user.tagIds = current.filter((t) => t !== tagId);
  await user.save();
  return getUserTags(userId);
};

// ── Notas ────────────────────────────────────────────────────
export const updateNotes = async (id: string, notes: string) => {
  const user = await User.findById(id);
  if (!user) throw makeError('User not found', 404);
  user.notes = notes ?? '';
  await user.save();
  return sanitize(user);
};

// ── Órdenes del usuario ──────────────────────────────────────
export const getUserOrders = async (userId: string): Promise<IOrderDocument[]> => {
  const orders = await Order.find({ user: userId });
  return orders.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
};

// ── Reenviar contraseña (regenerar + email) ──────────────────
const generateTempPassword = (length = 14): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

export const sendPasswordReset = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user) throw makeError('User not found', 404);

  const tempPassword = generateTempPassword();
  user.password = await hashPassword(tempPassword);
  await user.save();

  try {
    await sendCredentials({ name: user.name, email: user.email }, tempPassword, { isNew: false });
  } catch (err) {
    console.warn('[sendPasswordReset] email failed:', (err as Error).message);
  }

  return { tempPassword: env.nodeEnv === 'development' ? tempPassword : undefined };
};
