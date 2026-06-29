import slugify from 'slugify';
import { Package, IPackageDocument } from '../../molecules/models/package.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';

const err = (m: string, c: number): Error => Object.assign(new Error(m), { statusCode: c });

export const listPackages = async (): Promise<IPackageDocument[]> => {
  const pkgs = await Package.find({});
  return pkgs.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
};

export const getPackage = async (id: string): Promise<IPackageDocument> => {
  const pkg = await Package.findById(id);
  if (!pkg) throw err('Paquete no encontrado', 404);
  return pkg;
};

export const createPackage = async (input: Partial<IPackageDocument> & { name: string }): Promise<IPackageDocument> => {
  if (!input.name?.trim()) throw err('Nombre requerido', 400);
  const slug = slugify(input.name, { lower: true, strict: true });
  const exists = await Package.findOne({ slug });
  if (exists) throw err('Ya existe un paquete con ese nombre', 409);
  return Package.create({ ...input, slug });
};

export const updatePackage = async (id: string, data: Partial<IPackageDocument>): Promise<IPackageDocument> => {
  const pkg = await Package.findById(id);
  if (!pkg) throw err('Paquete no encontrado', 404);
  const allowed: (keyof IPackageDocument)[] = ['name', 'description', 'price', 'currency', 'courseIds', 'durationDays', 'isActive', 'isFeatured'];
  for (const k of allowed) if ((data as any)[k] !== undefined) (pkg as any)[k] = (data as any)[k];
  if (data.name) pkg.slug = slugify(data.name, { lower: true, strict: true });
  return pkg.save();
};

export const deletePackage = async (id: string): Promise<void> => {
  const pkg = await Package.findById(id);
  if (!pkg) throw err('Paquete no encontrado', 404);
  await Package.findByIdAndDelete(id);
};

// ── Asignación a usuario ─────────────────────────────────────
export const assignPackageToUser = async (userId: string, packageId: string) => {
  const [user, pkg] = await Promise.all([User.findById(userId), Package.findById(packageId)]);
  if (!user) throw err('Usuario no encontrado', 404);
  if (!pkg) throw err('Paquete no encontrado', 404);

  // Otorga todos los cursos del paquete (sin duplicados)
  const current = new Set(user.enrolledCourses ?? []);
  for (const cid of pkg.courseIds ?? []) current.add(cid);
  user.enrolledCourses = Array.from(current);
  user.contactStatus = 'customer';
  await user.save();

  const now = new Date();
  const periodEnd = pkg.durationDays > 0
    ? new Date(now.getTime() + pkg.durationDays * 86400000)
    : new Date(now.getTime() + 100 * 365 * 86400000); // "lifetime"

  const sub = await Subscription.create({
    user: userId,
    plan: pkg.slug,
    status: 'active',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    cancelAtPeriodEnd: false,
  } as any);

  return { user, package: pkg, subscription: sub };
};
