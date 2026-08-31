import { Subscription } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Offer } from '../../molecules/models/offer.model.js';
import { Order } from '../../molecules/models/order.model.js';
import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';
import { getPaymentSummary } from './payment.service.js';

// Recibo publico (sin login) enlazado desde el correo de confirmacion de
// suscripcion. Se muestra solo si hubo al menos un pago confirmado por Stripe
// (purchaseNotifiedAt) — una suscripcion INCOMPLETE (pago nunca confirmado)
// no tiene recibo que mostrar.
export const getSubscriptionReceipt = async (subscriptionId: string) => {
  const sub = await Subscription.findById(subscriptionId);
  if (!sub || !sub.purchaseNotifiedAt) return null;

  const [user, offer, paymentSummary] = await Promise.all([
    User.findById(String(sub.user)),
    sub.offerId ? Offer.findById(String(sub.offerId)) : null,
    getPaymentSummary(sub.stripeSubscriptionId),
  ]);

  return {
    id: String(sub._id),
    plan: sub.plan,
    offerTitle: offer?.title || 'Suscripción · Academia',
    status: sub.status,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    customerName: user?.name || '',
    customerEmail: user?.email || '',
    customerPhone: user?.phone || '',
    amount: paymentSummary.amountPaid || offer?.price || 0,
    currency: offer?.currency || 'MXN',
    cardLabel: paymentSummary.cardLabel,
    nextChargeAt: sub.cancelAtPeriodEnd ? null : paymentSummary.nextChargeAt,
    reference: sub.stripeSubscriptionId,
  };
};

// Recibo publico (sin login) de un pago unico — tickets de evento, libros.
// Enlazado desde sendEventOrderReceipt. Solo se muestra si la orden llego a
// COMPLETED (confirmada por el webhook de Stripe), no mientras esta PENDING.
export const getOrderReceipt = async (orderId: string) => {
  const order = await Order.findById(orderId);
  if (!order || order.status !== ORDER_STATUS.COMPLETED) return null;

  let customerName = order.contact?.name || '';
  let customerEmail = order.contact?.email || '';
  if (!customerEmail && order.user) {
    const user = await User.findById(order.user);
    customerName = user?.name || customerName;
    customerEmail = user?.email || customerEmail;
  }

  return {
    id: String(order._id),
    items: order.items.map((item) => ({ title: item.title, price: item.price, quantity: item.quantity ?? 1 })),
    subtotal: order.subtotal,
    tax: order.tax,
    shippingCost: order.shippingCost,
    total: order.total,
    currency: order.currency,
    customerName,
    customerEmail,
    paidAt: order.paidAt ?? null,
    reference: order.stripePaymentIntentId || String(order._id),
    shippingCarrier: order.shippingCarrier || '',
    shippingTrackingNumber: order.shippingTrackingNumber || '',
    shippingLabelUrl: order.shippingLabelUrl || '',
    shippingTrackUrl: order.shippingTrackUrl || '',
  };
};
