import { Subscription, ISubscriptionDocument } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Package } from '../../molecules/models/package.model.js';
import { SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';
import { findOfferByIdentity } from './offer.service.js';
import { sendAcademiaRenewalReminder, sendAcademiaExpiredNotice } from './email.service.js';
import { env } from '../../../config/env.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Ancla directo a las 3 cards de precio en /academia (id="academy-pricing" en
// Academy/index.tsx) en vez del tope de la pagina, para que el cliente no
// tenga que buscar donde renovar.
const ACADEMIA_RENEWAL_URL = `${env.clientUrl}/academia#academy-pricing`;

let workerStarted = false;

// Las suscripciones que otorga un paquete (assignPackageToUser) no tienen
// stripeSubscriptionId — a diferencia de las de Academia, que siempre vienen de Stripe.
const isPackageGrant = (sub: ISubscriptionDocument): boolean => !sub.stripeSubscriptionId;
// Compras pagadas de Academia (Order de un solo pago, ver grantAcademiaAccess
// en payment.service.ts) — siempre tienen offerId, a diferencia de los
// accesos gratis otorgados a mano (assignPackageToUser / importaciones).
const isAcademiaPurchase = (sub: ISubscriptionDocument): boolean => Boolean(sub.offerId);
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

      // Solo las compras pagadas de Academia avisan por correo que el acceso
      // se cortó — los grants gratis de paquete (admin/migración) no tienen
      // nada que "renovar", asi que no aplica mandarles este correo.
      if (isAcademiaPurchase(sub)) {
        try {
          const [user, offer] = await Promise.all([
            User.findById(String(sub.user)),
            findOfferByIdentity(String(sub.offerId)),
          ]);
          if (user?.email && offer) {
            await sendAcademiaExpiredNotice({
              name: user.name || 'Cliente',
              email: user.email,
              offerTitle: offer.title,
              renewUrl: ACADEMIA_RENEWAL_URL,
            });
          }
        } catch (emailErr) {
          console.warn('[package-expiration] no se pudo mandar el aviso de vencimiento', idOf(sub), (emailErr as Error).message);
        }
      }
    } catch (err) {
      console.error('[package-expiration] no se pudo expirar la suscripcion', idOf(sub), (err as Error).message);
    }
  }

  return { checked: active.length, expired: dueForExpiry.length };
};

// Corre junto con expirePackageGrants: manda el correo de "tu acceso vence
// pronto" en dos ventanas (7 dias antes, y 1 dia antes/el dia que vence) a
// las compras pagadas de Academia que todavia siguen activas. Cada ventana
// se manda una sola vez por periodo — el flag correspondiente se resetea a
// null en cada renovacion (ver grantAcademiaAccess en payment.service.ts).
export const sendUpcomingRenewalReminders = async (): Promise<{ checked: number; reminded: number }> => {
  const now = Date.now();
  const active = await Subscription.find({ status: SUBSCRIPTION_STATUS.ACTIVE });
  const academiaSubs = active.filter(isAcademiaPurchase);
  let reminded = 0;

  for (const sub of academiaSubs) {
    try {
      const expiresAt = new Date(String(sub.currentPeriodEnd));
      const daysLeft = Math.ceil((expiresAt.getTime() - now) / DAY_MS);
      if (daysLeft > 7 || daysLeft < 0) continue;

      const window: 'reminder7dSentAt' | 'reminder1dSentAt' | null =
        daysLeft <= 1 ? 'reminder1dSentAt' : daysLeft === 7 ? 'reminder7dSentAt' : null;
      if (!window) continue;

      const flagField = window === 'reminder7dSentAt' ? 'renewalReminder7dSentAt' : 'renewalReminder1dSentAt';
      if ((sub as any)[flagField]) continue;

      const [user, offer] = await Promise.all([
        User.findById(String(sub.user)),
        findOfferByIdentity(String(sub.offerId)),
      ]);
      if (!user?.email || !offer) continue;

      await sendAcademiaRenewalReminder({
        name: user.name || 'Cliente',
        email: user.email,
        offerTitle: offer.title,
        expiresAt,
        daysLeft,
        renewUrl: ACADEMIA_RENEWAL_URL,
      });

      await Subscription.findByIdAndUpdate(idOf(sub), { [flagField]: new Date().toISOString() } as any);
      reminded += 1;
    } catch (err) {
      console.error('[package-expiration] no se pudo mandar recordatorio de renovacion', idOf(sub), (err as Error).message);
    }
  }

  return { checked: academiaSubs.length, reminded };
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
      const reminders = await sendUpcomingRenewalReminders();
      if (reminders.reminded > 0) {
        console.log(`[package-expiration] recordatorios de renovación enviados: ${reminders.reminded}`);
      }
    } catch (err) {
      console.error('[package-expiration] worker error:', (err as Error).message);
    }
  };

  void run();
  setInterval(() => { void run(); }, CHECK_INTERVAL_MS);
  console.log('[package-expiration] worker started (revisa vencimientos y recordatorios 1 vez al dia)');
};
