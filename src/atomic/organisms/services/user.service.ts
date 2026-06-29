import { User, IUserDocument } from '../../molecules/models/user.model.js';
import { Tag, ITagDocument } from '../../molecules/models/tag.model.js';
import { Order, IOrderDocument } from '../../molecules/models/order.model.js';
import { hashPassword } from '../../atoms/helpers/hash.helper.js';
import { env } from '../../../config/env.js';

const makeError = (message: string, statusCode: number): Error =>
  Object.assign(new Error(message), { statusCode });

interface ListParams { page?: number; limit?: number; search?: string; tagId?: string; role?: string }

const sanitize = (u: IUserDocument): any => {
  const { password: _p, resetPasswordToken: _r, emailVerifyToken: _e, ...rest } = u as any;
  return rest;
};

export const getById = async (id: string): Promise<IUserDocument> => {
  const user = await User.findById(id).populate('enrolledCourses', 'title slug thumbnail category shortDescription');
  if (!user) throw makeError('User not found', 404);
  return user;
};

export const getByIdSanitized = async (id: string) => {
  const user = await getById(id);
  return sanitize(user);
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

export const listUsers = async ({ page = 1, limit = 20, search = '', tagId, role }: ListParams) => {
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

  filtered.sort((a, b) => {
    const ad = new Date(String(a.createdAt)).getTime();
    const bd = new Date(String(b.createdAt)).getTime();
    return bd - ad;
  });

  const total = filtered.length;
  const sliced = filtered.slice((page - 1) * limit, page * limit).map(sanitize);
  return { users: sliced, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
};

export const toggleActive = async (id: string): Promise<IUserDocument> => {
  const user = await User.findById(id);
  if (!user) throw makeError('User not found', 404);
  user.isActive = !user.isActive;
  return user.save();
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
    const html = `
      <h1>Hola ${user.name},</h1>
      <p>Se restableció tu contraseña de la <strong>Academia Diego Díaz</strong>.</p>
      <p><strong>Correo:</strong> ${user.email}<br />
         <strong>Nueva contraseña:</strong> <code>${tempPassword}</code></p>
      <p>Inicia sesión en <a href="${env.clientUrl}/iniciar-sesion">${env.clientUrl}/iniciar-sesion</a>
         y cámbiala desde tu perfil al primer ingreso.</p>
    `;
    const nodemailer = (await import('nodemailer')).default;
    await nodemailer
      .createTransport({ host: env.mail.host, port: env.mail.port, auth: { user: env.mail.user, pass: env.mail.pass } })
      .sendMail({ from: env.mail.from, to: user.email, subject: 'Tu nueva contraseña — Academia Diego Díaz', html });
  } catch (err) {
    console.warn('[sendPasswordReset] email failed:', (err as Error).message);
  }

  return { tempPassword: env.nodeEnv === 'development' ? tempPassword : undefined };
};

