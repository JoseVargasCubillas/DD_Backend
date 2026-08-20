import { Subscription, ISubscriptionDocument } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Package } from '../../molecules/models/package.model.js';
import { SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let workerStarted = false;

// Las suscripciones que otorga un paquete (assignPackageToUser) no tienen
// stripeSubscriptionId — a diferencia de las de Academia, que siempre vienen de Stripe.
const isPackageGrant = (sub: ISubscriptionDocument): boolean => !sub.stripeSubscriptionId;
const idOf = (doc: { _id?: string; id?: string }): string => String(doc._id ?? doc.id ?? '');

// Corre una vez al dia: revoca el acceso a los cursos de un paquete cuyo
// periodo (currentPeriodEnd, definido por durationDays al asignarlo) ya paso.
// No toca cursos que el usuario siga teniendo por otro paquete activo distinto.
export const expirePackageGrants = async (): Promise<{ checked: number; expired: number }> => {
  const now = Date.now();
  const active = await Subscription.find({ status: SUBSCRIPTION_STATUS.ACTIVE });
  const dueForExpiry = active.filter(
    (sub) => isPackageGrant(sub) && new Date(String(sub.currentPeriodEnd)).getTime() < now,
  );

  for (const sub of dueForExpiry) {
    try {
      const pkg = await Package.findOne({ slug: sub.plan });

      if (pkg?.courseIds?.length) {
        const otherActiveGrants = active.filter(
          (other) =>
            String(other.user) === String(sub.user) &&
            idOf(other) !== idOf(sub) &&
            isPackageGrant(other) &&
            new Date(String(other.currentPeriodEnd)).getTime() >= now,
        );
        const otherPackages = await Promise.all(
          otherActiveGrants.map((other) => Package.findOne({ slug: other.plan })),
        );
        const stillGranted = new Set(otherPackages.flatMap((p) => p?.courseIds ?? []));

        const user = await User.findById(String(sub.user));
        if (user) {
          user.enrolledCourses = (user.enrolledCourses ?? []).filter(
            (courseId) => !pkg.courseIds.includes(courseId) || stillGranted.has(courseId),
          );
          await user.save();
        }
      }

      sub.status = SUBSCRIPTION_STATUS.CANCELED;
      await sub.save();
    } catch (err) {
      console.error('[package-expiration] no se pudo expirar la suscripcion', idOf(sub), (err as Error).message);
    }
  }

  return { checked: active.length, expired: dueForExpiry.length };
};

export const startPackageExpirationWorker = (): void => {
  if (workerStarted) return;
  workerStarted = true;

  const run = async (): Promise<void> => {
    try {
      const result = await expirePackageGrants();
      if (result.expired > 0) {
        console.log(`[package-expiration] revisados ${result.checked}, expirados ${result.expired}`);
      }
    } catch (err) {
      console.error('[package-expiration] worker error:', (err as Error).message);
    }
  };

  void run();
  setInterval(() => { void run(); }, CHECK_INTERVAL_MS);
  console.log('[package-expiration] worker started (revisa vencimientos 1 vez al dia)');
};
