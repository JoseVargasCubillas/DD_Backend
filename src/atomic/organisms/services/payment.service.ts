import { stripe } from '../../../config/stripe.js';
import { Order, IOrderDocument } from '../../molecules/models/order.model.js';
import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';
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

export const handleWebhook = async (event: Stripe.Event): Promise<void> => {
  if (event.type === 'payment_intent.succeeded') {
    await confirmPayment((event.data.object as Stripe.PaymentIntent).id);
  }
};

export const getOrdersByUser = async (userId: string): Promise<IOrderDocument[]> =>
  Order.find({ user: userId }).sort('-createdAt');
