import slugify from 'slugify';
import { Package, IPackageDocument } from '../../molecules/models/package.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';
import { sendAcademiaManualAccess } from './email.service.js';
import { issueWhatsappInviteTokenForPackage, buildWhatsappInviteUrl } from './whatsapp-invite.service.js';

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

// Élite Privé: membresía vendida en eventos (no pública). Misma oferta que Business
// con grupo de WhatsApp propio. Se garantiza su existencia al listar paquetes para
// que aparezca siempre como opción al asignar suscripciones desde el admin.
const ELITE_WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/JgoggooO4BzGvcU2jEMZl9';

const ensureElitePackage = async (pkgs: IPackageDocument[]): Promise<IPackageDocument[]> => {
  const hasElite = pkgs.some((p) => String(p.tier || '').toLowerCase() === 'elite' || p.slug === 'elite-prive');
  if (hasElite) return pkgs;
  const business = pkgs.find((p) => String(p.tier || '').toLowerCase() === 'business');
  const benefits = {
    ...((business?.benefits as Record<string, unknown>) ?? { allCourses: true, masterclassEveryTwoMonths: true }),
    whatsappGroupAdvisors: { enabled: true, url: ELITE_WHATSAPP_GROUP_URL },
  };
  const elite = await Package.create({
    name: 'Élite Privé',
    slug: 'elite-prive',
    tier: 'elite',
    description: 'Mismos beneficios que Business con grupo de WhatsApp propio. Se vende en eventos presenciales; no aparece en la web y sólo se asigna manualmente.',
    price: 7997,
    currency: business?.currency ?? 'MXN',
    courseIds: [...(business?.courseIds ?? [])],
    durationDays: business?.durationDays ?? 365,
    billingInterval: business?.billingInterval ?? 'year',
    isActive: true,
    isFeatured: false,
    benefits,
  } as Partial<IPackageDocument>);
  return [...pkgs, elite];
};

export const listPackages = async (): Promise<IPackageDocument[]> => {
  const pkgs = await ensureElitePackage(await Package.find({}));
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
  const allowed: (keyof IPackageDocument)[] = [
    'name', 'description', 'price', 'currency', 'courseIds', 'durationDays', 'expiresAt', 'isActive', 'isFeatured',
    'tier', 'billingInterval', 'benefits',
  ];
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

// Agrega un curso publicado a todos los paquetes activos que aun no lo
// contengan. Se llama desde course.service cuando se crea o publica un
// curso, para que los suscriptores existentes (cuyo acceso se resuelve
// leyendo pkg.courseIds en runtime, ver getUserCourseAccess) reciban el
// curso nuevo sin que el admin tenga que editar cada paquete a mano.
export const syncCourseIntoActivePackages = async (courseId: string): Promise<number> => {
  const id = String(courseId || '').trim();
  if (!id) return 0;
  const pkgs = await Package.find({});
  let touched = 0;
  for (const pkg of pkgs) {
    if (!pkg.isActive) continue;
    const current = new Set((pkg.courseIds ?? []).map(String));
    if (current.has(id)) continue;
    current.add(id);
    pkg.courseIds = Array.from(current);
    await pkg.save();
    touched += 1;
  }
  return touched;
};

// ── Asignación a usuario ─────────────────────────────────────
// durationDays (opcional): días de acceso elegidos por el admin. Si no viene o
// no es un número positivo, se usa la vigencia del paquete.
export const assignPackageToUser = async (userId: string, packageId: string, durationDays?: number | null) => {
  const [user, pkg] = await Promise.all([User.findById(userId), Package.findById(packageId)]);
  if (!user) throw err('Usuario no encontrado', 404);
  if (!pkg) throw err('Paquete no encontrado', 404);

  // Otorga todos los cursos del paquete (sin duplicados)
  const current = new Set(user.enrolledCourses ?? []);
  for (const cid of pkg.courseIds ?? []) current.add(cid);
  user.enrolledCourses = Array.from(current);
  user.contactStatus = 'customer';
  // Todos los miembros de la Academia reciben el mailing (salvo baja explícita).
  if (user.marketingStatus !== 'unsubscribed') user.marketingStatus = 'subscribed';
  await user.save();

  const now = new Date();
  const customDays = Number(durationDays);
  const periodEnd =
    Number.isFinite(customDays) && customDays > 0
      ? new Date(now.getTime() + Math.floor(customDays) * 86400000)
      : getPackagePeriodEnd(pkg, now);

  // Si ya existe una suscripción activa para este usuario+paquete, la
  // renovamos en lugar de crear una fila nueva (evita duplicados en
  // "Clientes con suscripción activa" cuando el admin reasigna varias veces).
  const existing = await Subscription.findOne({
    user: userId,
    packageId,
    status: 'active',
  });

  // Token nuevo en cada asignación/renovación (paquetes con grupo de WhatsApp):
  // invalida cualquier enlace viejo que el cliente no haya usado todavía.
  const whatsappInviteToken = issueWhatsappInviteTokenForPackage(pkg);

  let sub;
  if (existing) {
    existing.currentPeriodStart = now.toISOString() as any;
    existing.currentPeriodEnd = periodEnd.toISOString() as any;
    existing.cancelAtPeriodEnd = false;
    existing.plan = pkg.slug as any;
    existing.whatsappInviteToken = whatsappInviteToken;
    existing.whatsappInviteUsedAt = null;
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
      whatsappInviteToken,
      whatsappInviteUsedAt: null,
    } as any);
  }

  // Correo de confirmación con vigencia y, si aplica, el enlace al grupo de
  // WhatsApp. No bloquea la asignación si el SMTP falla.
  if (user.email) {
    try {
      await sendAcademiaManualAccess({
        customerName: user.name || 'Cliente',
        customerEmail: user.email,
        planName: pkg.name,
        accessUntil: periodEnd,
        isRenewal: Boolean(existing),
        whatsappJoinUrl: whatsappInviteToken ? buildWhatsappInviteUrl(whatsappInviteToken) : undefined,
      });
    } catch (mailErr) {
      console.warn(`[assignPackageToUser] correo de acceso falló para ${user.email}:`, (mailErr as Error).message);
    }
  }

  return { user, package: pkg, subscription: sub };
};
