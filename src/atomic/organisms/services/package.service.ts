import slugify from 'slugify';
import { Package, IPackageDocument } from '../../molecules/models/package.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';

const err = (m: string, c: number): Error => Object.assign(new Error(m), { statusCode: c });

const normalizeExpiresAt = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw err('Fecha de vencimiento inválida', 400);
  return date.toISOString();
};

const getPackagePeriodEnd = (pkg: IPackageDocument, now: Date): Date => {
  const durationDays = Number(pkg.durationDays);
  const accessDays = Number.isFinite(durationDays) && durationDays > 0 ? durationDays : 365;
  return new Date(now.getTime() + accessDays * 86400000);
};

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
  return Package.create({ ...input, expiresAt: normalizeExpiresAt(input.expiresAt), slug });
};

export const updatePackage = async (id: string, data: Partial<IPackageDocument>): Promise<IPackageDocument> => {
  const pkg = await Package.findById(id);
  if (!pkg) throw err('Paquete no encontrado', 404);
  const allowed: (keyof IPackageDocument)[] = ['name', 'description', 'price', 'currency', 'courseIds', 'durationDays', 'expiresAt', 'isActive', 'isFeatured'];
  for (const k of allowed) {
    if ((data as any)[k] === undefined) continue;
    (pkg as any)[k] = k === 'expiresAt' ? normalizeExpiresAt((data as any)[k]) : (data as any)[k];
  }
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
  const periodEnd = getPackagePeriodEnd(pkg, now);

  // Si ya existe una suscripción activa para este usuario+paquete, la
  // renovamos en lugar de crear una fila nueva (evita duplicados en
  // "Clientes con suscripción activa" cuando el admin reasigna varias veces).
  const existing = await Subscription.findOne({
    user: userId,
    packageId,
    status: 'active',
  });

  let sub;
  if (existing) {
    existing.currentPeriodStart = now.toISOString() as any;
    existing.currentPeriodEnd = periodEnd.toISOString() as any;
    existing.cancelAtPeriodEnd = false;
    existing.plan = pkg.slug as any;
    sub = await existing.save();
  } else {
    sub = await Subscription.create({
      user: userId,
      packageId,
      plan: pkg.slug,
      status: 'active',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      cancelAtPeriodEnd: false,
    } as any);
  }

  return { user, package: pkg, subscription: sub };
};
