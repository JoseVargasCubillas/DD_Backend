import { stripe } from '../../../config/stripe.js';
import { Subscription, ISubscriptionDocument } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Package } from '../../molecules/models/package.model.js';
import { SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';
import { findOfferByIdentity } from './offer.service.js';

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });

export const cancelSubscription = async (userId: string): Promise<ISubscriptionDocument> => {
  const sub = await Subscription.findOne({ user: userId, status: SUBSCRIPTION_STATUS.ACTIVE });
  if (!sub) throw makeError('No active subscription', 404);

  // Las suscripciones de Academia ya no se crean en Stripe (ver
  // grantAcademiaAccess en payment.service.ts) — solo las viejas filas de
  // antes de ese cambio tienen un stripeSubscriptionId real que cancelar ahi.
  if (sub.stripeSubscriptionId) {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
  }
  sub.cancelAtPeriodEnd = true;
  return sub.save();
};

export const getActiveSubscription = async (userId: string): Promise<ISubscriptionDocument | null> =>
  Subscription.findOne({ user: userId, status: SUBSCRIPTION_STATUS.ACTIVE });

// Fila enriquecida para el panel de admin: junta cada Subscription con el
// nombre/correo del usuario y el titulo de la oferta/paquete, para no
// depender de heuristicas sobre Order (que son compras de un solo pago).
// Excluye INCOMPLETE: son intentos de checkout cuyo primer pago todavia no se
// confirma (o se abandonaron), no deben contar como venta en el admin.
export const listAllSubscriptions = async () => {
  const subs = await Subscription.find({ status: { $ne: SUBSCRIPTION_STATUS.INCOMPLETE } }).sort({ createdAt: -1 });

  // Dedupe: si por bugs viejos hay múltiples filas para el mismo usuario+paquete+oferta,
  // sólo mostramos la más reciente (ya viene ordenada por createdAt desc).
  const seen = new Set<string>();
  const unique = subs.filter((sub) => {
    const key = `${String(sub.user)}::${sub.packageId ?? ''}::${sub.offerId ?? ''}::${sub.stripeSubscriptionId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Promise.all(
    unique.map(async (sub) => {
      const [user, offer, pkg] = await Promise.all([
        User.findById(String(sub.user)),
        sub.offerId ? findOfferByIdentity(String(sub.offerId)) : null,
        sub.packageId ? Package.findById(String(sub.packageId)) : null,
      ]);

      // offerId presente = compra pagada de Academia (Order de un solo pago,
      // renovacion manual). Sin offerId ni stripeSubscriptionId = acceso
      // otorgado a mano por un admin (assignPackageToUser / importacion).
      const source = sub.offerId ? 'order' : sub.stripeSubscriptionId ? 'stripe' : 'manual_admin';

      return {
        _id: sub._id,
        id: sub._id,
        user: String(sub.user),
        plan: sub.plan,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        package: sub.packageId || null,
        offer: sub.offerId || null,
        orderId: sub.orderId || null,
        startDate: sub.currentPeriodStart,
        source,
        createdAt: sub.createdAt,
        userName: user?.name || '',
        userEmail: user?.email || '',
        packageName: pkg?.name || null,
        packageTier: offer?.plan || null,
        offerTitle: offer?.title || null,
        price: offer?.price ?? pkg?.price ?? null,
        currency: offer?.currency ?? pkg?.currency ?? 'MXN',
      };
    }),
  );
};
