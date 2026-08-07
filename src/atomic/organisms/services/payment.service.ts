import { stripe } from '../../../config/stripe.js';
import { env } from '../../../config/env.js';
import { Order, IOrderDocument, IOrderShippingAddress } from '../../molecules/models/order.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Book } from '../../molecules/models/book.model.js';
import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';
import { sendAdminSubscriptionNotice, sendCustomerSubscriptionNotice } from './email.service.js';
import Stripe from 'stripe';

interface OrderItemInput { type: string; refId: string; title: string; price: number; quantity?: number }

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });
const isStripeConfigured = (): boolean =>
  env.stripe.secretKey.startsWith('sk_') && !env.stripe.secretKey.includes('placeholder');

const normalizeOrderItems = async (items: OrderItemInput[]): Promise<OrderItemInput[]> => {
  if (!Array.isArray(items) || items.length === 0) throw makeError('Pedido vacío', 400);

  return Promise.all(
    items.map(async (item) => {
      const quantity = Math.max(1, Number(item.quantity ?? 1));
      const type = String(item.type || '').toLowerCase();

      if (type === 'product' || type === 'book') {
        const refId = String(item.refId || '');
        const book = (await Book.findById(refId)) ?? (await Book.findOne({ slug: refId }));
        if (!book || !book.isActive) throw makeError('Libro no disponible', 400);

        return {
          type: 'product',
          refId: String(book._id),
          title: book.title,
          price: Number(book.price),
          quantity,
        };
      }

      const price = Number(item.price);
      if (!Number.isFinite(price) || price <= 0) throw makeError('Precio inválido', 400);

      return {
        type: item.type,
        refId: item.refId,
        title: item.title,
        price,
        quantity,
      };
    }),
  );
};

// Pedidos con envío (productos físicos, ej. libros) calculan subtotal + envío + IVA por separado.
// Los pedidos existentes (cursos, suscripciones) conservan su comportamiento: el precio del item
// ya es el total a cobrar, sin desglose de impuestos, para no alterar montos ya en producción.
export const createPaymentIntent = async (
  userId: string,
  items: OrderItemInput[],
  shipping?: IOrderShippingAddress,
) => {
  const normalizedItems = await normalizeOrderItems(items);
  const subtotal = normalizedItems.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0);
  const requiresShipping = Boolean(shipping) || normalizedItems.some((i) => i.type === 'product');
  const shippingCost = requiresShipping ? 0 : 0;
  const tax = 0;
  const total = requiresShipping ? subtotal + shippingCost + tax : subtotal;

  if (!isStripeConfigured()) {
    const demoPaymentIntentId = `demo_pi_${Date.now()}`;
    const order = await Order.create({
      user: userId, items: normalizedItems, subtotal, tax, shippingCost, shipping: shipping ?? null, total,
      status: ORDER_STATUS.COMPLETED,
      stripePaymentIntentId: demoPaymentIntentId,
      paidAt: new Date(),
      notes: 'Pago confirmado en modo demo local por falta de llaves reales de Stripe.',
    });
    return { clientSecret: `demo_${order._id}`, orderId: order._id, subtotal, tax, shippingCost, total };
  }

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100),
    currency: 'mxn',
    metadata: { userId },
  });
  const order = await Order.create({
    user: userId, items: normalizedItems, subtotal, tax, shippingCost, shipping: shipping ?? null, total,
    status: ORDER_STATUS.PENDING,
    stripePaymentIntentId: intent.id,
  });
  return { clientSecret: intent.client_secret, orderId: order._id, subtotal, tax, shippingCost, total };
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

export const getAllOrders = async (): Promise<IOrderDocument[]> =>
  Order.find({}).sort('-createdAt');
