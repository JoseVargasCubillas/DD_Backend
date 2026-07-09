import { stripe } from '../../../config/stripe.js';
import { Order, IOrderDocument } from '../../molecules/models/order.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';
import { sendAdminSubscriptionNotice, sendCustomerSubscriptionNotice } from './email.service.js';
import Stripe from 'stripe';

interface OrderItemInput { type: string; refId: string; title: string; price: number; quantity?: number }

export const createPaymentIntent = async (userId: string, items: OrderItemInput[]) => {
  const total = items.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0);
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100),
    currency: 'mxn',
    metadata: { userId },
  });
  const order = await Order.create({
    user: userId, items, subtotal: total, total,
    status: ORDER_STATUS.PENDING,
    stripePaymentIntentId: intent.id,
  });
  return { clientSecret: intent.client_secret, orderId: order._id };
};

export const confirmPayment = async (paymentIntentId: string): Promise<IOrderDocument | null> => {
  const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
  if (!order) return null;
  order.status = ORDER_STATUS.COMPLETED;
  order.paidAt = new Date();
  return order.save();
};

const notifyConfirmedSubscription = async (stripeSubscriptionId?: string | null): Promise<void> => {
  if (!stripeSubscriptionId) return;

  const sub = await Subscription.findOne({ stripeSubscriptionId });
  if (!sub || sub.purchaseNotifiedAt) return;

  const user = await User.findById(String(sub.user));
  if (!user?.email) return;

  const payload = {
    customerName: user.name || 'Cliente',
    customerEmail: user.email,
    customerPhone: user.phone || '',
    plan: sub.plan,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    stripePriceId: sub.stripePriceId,
  };

  await Promise.all([
    sendAdminSubscriptionNotice(payload),
    sendCustomerSubscriptionNotice(payload),
  ]);

  sub.purchaseNotifiedAt = new Date().toISOString();
  await sub.save();
  await User.findByIdAndUpdate(String(user._id), { contactStatus: 'customer', plan: sub.plan });
};

const getSubscriptionIdFromInvoice = (invoice: Stripe.Invoice): string | null => {
  const subscription = (invoice as any).subscription;
  if (!subscription) return null;
  return typeof subscription === 'string' ? subscription : subscription.id;
};

export const handleWebhook = async (event: Stripe.Event): Promise<void> => {
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await confirmPayment(paymentIntent.id);
    return;
  }

  if (event.type === 'invoice.payment_succeeded') {
    await notifyConfirmedSubscription(getSubscriptionIdFromInvoice(event.data.object as Stripe.Invoice));
  }
};

export const getOrdersByUser = async (userId: string): Promise<IOrderDocument[]> =>
  Order.find({ user: userId }).sort('-createdAt');
