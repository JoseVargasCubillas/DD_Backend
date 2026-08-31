import { stripe } from '../../../config/stripe.js';
import { env } from '../../../config/env.js';
import { Order, IOrderDocument, IOrderShippingAddress, IOrderContact } from '../../molecules/models/order.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Book } from '../../molecules/models/book.model.js';
import { Event } from '../../molecules/models/event.model.js';
import { ORDER_STATUS, SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';
import {
  sendAdminSubscriptionNotice,
  sendCustomerSubscriptionNotice,
  sendCredentials,
  sendEventOrderReceipt,
} from './email.service.js';
import { hashPassword, generateTempPassword } from '../../atoms/helpers/hash.helper.js';
import Stripe from 'stripe';

interface OrderItemInput { type: string; refId: string; title: string; price: number; quantity?: number }
interface CheckoutContactInput { name?: string; email?: string; phone?: string }

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });
const ANNUAL_ACCESS_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const isStripeConfigured = (): boolean =>
  env.stripe.secretKey.startsWith('sk_') && !env.stripe.secretKey.includes('placeholder');

// Tickets de evento que no corresponden a un solo `Event` de la DB con precio
// único (p.ej. los 3 tiers de un mismo taller). El precio autoritativo vive
// aquí, nunca se confía en el que manda el cliente.
const EVENT_TICKET_CATALOG: Record<string, { title: string; price: number }> = {
  'holding-masterclass-2026': { title: 'Holding · El legado de los empresarios', price: 4997 },
  'estrategia-fiscal-online': { title: 'Taller de Estrategia Fiscal · Online', price: 4997 },
  'estrategia-fiscal-general': { title: 'Taller de Estrategia Fiscal · General CDMX', price: 7997 },
  'estrategia-fiscal-vip': { title: 'Taller de Estrategia Fiscal · VIP CDMX', price: 24997 },
};

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

      if (type === 'event') {
        const refId = String(item.refId || '');
        const catalogEntry = EVENT_TICKET_CATALOG[refId];
        if (catalogEntry) {
          return { type: 'event', refId, title: catalogEntry.title, price: catalogEntry.price, quantity };
        }

        const event = (await Event.findById(refId)) ?? (await Event.findOne({ slug: refId }));
        if (!event) throw makeError('Evento no disponible', 400);
        const price = Number(event.salePrice ?? event.price ?? 0);
        if (!(price > 0)) throw makeError('Este evento no tiene costo configurado', 400);

        return { type: 'event', refId: String(event._id), title: event.title, price, quantity };
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

const normalizeGuestContact = (contact?: CheckoutContactInput): IOrderContact => {
  const name = String(contact?.name || '').trim();
  const email = String(contact?.email || '').trim().toLowerCase();
  const phone = String(contact?.phone || '').trim();
  if (name.length < 2) throw makeError('Nombre requerido', 400);
  if (!/\S+@\S+\.\S+/.test(email)) throw makeError('Correo requerido', 400);
  if (phone.length < 10) throw makeError('Celular requerido', 400);
  return { name, email, phone };
};

// Los tickets de evento nunca requieren cuenta: no se crea ni se asocia
// ningun User, solo se guarda el contacto (nombre + correo) en la orden
// para poder mandar el recibo. Cualquier otro tipo de compra (libros,
// cursos, suscripciones) sigue requiriendo sesion iniciada.
const resolveOrderOwner = (
  userId: string | undefined,
  isEventOnly: boolean,
  customer?: CheckoutContactInput,
): { user: string; contact: IOrderContact | null } => {
  if (isEventOnly) return { user: '', contact: normalizeGuestContact(customer) };
  if (!userId) throw makeError('Inicia sesión para continuar', 401);
  return { user: userId, contact: null };
};

const sendReceiptIfEventOrder = async (order: IOrderDocument): Promise<void> => {
  if (!order.contact) return;
  try {
    await sendEventOrderReceipt({ name: order.contact.name, email: order.contact.email, order });
  } catch (err) {
    console.warn('[sendReceiptIfEventOrder] failed:', (err as Error).message);
  }
};

// Pedidos con envío (productos físicos, ej. libros) calculan subtotal + envío + IVA por separado.
// Los pedidos existentes (cursos, suscripciones) conservan su comportamiento: el precio del item
// ya es el total a cobrar, sin desglose de impuestos, para no alterar montos ya en producción.
export const createPaymentIntent = async (
  userId: string | undefined,
  items: OrderItemInput[],
  shipping?: IOrderShippingAddress,
  customer?: CheckoutContactInput,
) => {
  const normalizedItems = await normalizeOrderItems(items);
  const isEventOnly = normalizedItems.every((i) => i.type === 'event');
  const { user, contact } = resolveOrderOwner(userId, isEventOnly, customer);
  const subtotal = normalizedItems.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0);
  const requiresShipping = Boolean(shipping) || normalizedItems.some((i) => i.type === 'product');
  const shippingCost = requiresShipping ? 0 : 0;
  const tax = 0;
  const total = requiresShipping ? subtotal + shippingCost + tax : subtotal;

  if (!isStripeConfigured()) {
    const demoPaymentIntentId = `demo_pi_${Date.now()}`;
    const order = await Order.create({
      user, contact, items: normalizedItems, subtotal, tax, shippingCost, shipping: shipping ?? null, total,
      status: ORDER_STATUS.COMPLETED,
      stripePaymentIntentId: demoPaymentIntentId,
      paidAt: new Date(),
      notes: 'Pago confirmado en modo demo local por falta de llaves reales de Stripe.',
    });
    await sendReceiptIfEventOrder(order);
    return { clientSecret: `demo_${order._id}`, orderId: order._id, subtotal, tax, shippingCost, total };
  }

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100),
    currency: 'mxn',
    metadata: { userId: user },
  });
  const order = await Order.create({
    user, contact, items: normalizedItems, subtotal, tax, shippingCost, shipping: shipping ?? null, total,
    status: ORDER_STATUS.PENDING,
    stripePaymentIntentId: intent.id,
  });
  return { clientSecret: intent.client_secret, orderId: order._id, subtotal, tax, shippingCost, total };
};

export const confirmPayment = async (paymentIntentId: string): Promise<IOrderDocument | null> => {
  const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
  if (!order) return null;

  // Guarda contra reintentos del webhook de Stripe (entrega "al menos una
  // vez"): sin esto, cada redelivery del mismo payment_intent.succeeded
  // reenviaria el recibo de compra al cliente.
  if (order.status === ORDER_STATUS.COMPLETED) return order;

  order.status = ORDER_STATUS.COMPLETED;
  order.paidAt = new Date();
  const saved = await order.save();
  await sendReceiptIfEventOrder(saved);
  return saved;
};

// Datos de la tarjeta y del recibo de Stripe para el correo administrativo.
// Best effort: si Stripe no configuró alguno de estos campos, el correo se manda igual sin ellos.
export const getPaymentSummary = async (
  stripeSubscriptionId: string,
): Promise<{ cardLabel: string; receiptUrl: string; nextChargeAt: Date | null; amountPaid: number }> => {
  try {
    const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ['default_payment_method', 'latest_invoice'],
    });
    const paymentMethod = stripeSub.default_payment_method as Stripe.PaymentMethod | null;
    const card = paymentMethod?.card;
    const cardLabel = card ? `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} · terminación ${card.last4}` : '';
    const invoice = stripeSub.latest_invoice as Stripe.Invoice | null;
    return {
      cardLabel,
      receiptUrl: invoice?.hosted_invoice_url || '',
      nextChargeAt: stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : null,
      amountPaid: invoice?.amount_paid ? invoice.amount_paid / 100 : 0,
    };
  } catch (err) {
    console.warn('[getPaymentSummary] failed:', (err as Error).message);
    return { cardLabel: '', receiptUrl: '', nextChargeAt: null, amountPaid: 0 };
  }
};

// Corre en cada factura pagada (alta inicial y cada renovacion). `invoice.id`
// funciona como guardia contra reintentos del webhook de Stripe: si ya
// notificamos esa factura exacta, no se repite el correo.
const notifyConfirmedSubscription = async (invoice: Stripe.Invoice): Promise<void> => {
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;

  const sub = await Subscription.findOne({ stripeSubscriptionId });
  if (!sub || sub.lastNotifiedInvoiceId === invoice.id) return;

  const user = await User.findById(String(sub.user));
  if (!user?.email) return;

  const isFirstPayment = !sub.purchaseNotifiedAt;
  const paymentSummary = await getPaymentSummary(sub.stripeSubscriptionId);

  const payload = {
    orderId: String(sub._id || sub.id || ''),
    customerId: String(user._id || user.id || ''),
    customerName: user.name || 'Cliente',
    customerEmail: user.email,
    customerPhone: user.phone || '',
    plan: sub.plan,
    isRenewal: !isFirstPayment,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    stripePriceId: sub.stripePriceId,
    ...paymentSummary,
    // Recibo propio en vez del hosted_invoice_url de Stripe (paymentSummary.receiptUrl):
    // ese nunca fue una factura CFDI valida ante el SAT, solo un recibo generico de Stripe.
    // Esta pagina muestra los mismos datos con la marca de Diego Diaz.
    receiptUrl: `${env.clientUrl}/recibo/${sub._id}`,
  };

  const emailsToSend = [sendAdminSubscriptionNotice(payload), sendCustomerSubscriptionNotice(payload)];

  // Cuentas de invitado se crean sin password utilizable (ver getCheckoutUser en
  // subscription.service.ts). Aqui, ya con el pago confirmado, se genera la
  // contrasena temporal real y se manda por correo junto con las otras dos.
  // Solo aplica al primer pago: si ya tiene password, ya recibio su correo de acceso antes.
  if (isFirstPayment && !user.password) {
    const tempPassword = generateTempPassword();
    await User.findByIdAndUpdate(String(user._id), { password: await hashPassword(tempPassword) });
    emailsToSend.push(sendCredentials({ name: user.name, email: user.email }, tempPassword, { isNew: true }));
  }

  await Promise.all(emailsToSend);

  sub.status = SUBSCRIPTION_STATUS.ACTIVE;
  sub.lastNotifiedInvoiceId = invoice.id;
  const currentPeriodStart = new Date();
  sub.currentPeriodStart = currentPeriodStart.toISOString();
  sub.currentPeriodEnd = new Date(currentPeriodStart.getTime() + ANNUAL_ACCESS_DAYS * DAY_MS).toISOString();
  if (isFirstPayment) sub.purchaseNotifiedAt = new Date().toISOString();
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
    await notifyConfirmedSubscription(event.data.object as Stripe.Invoice);
  }
};

export const getOrdersByUser = async (userId: string): Promise<IOrderDocument[]> =>
  Order.find({ user: userId }).sort('-createdAt');

export const getAllOrders = async (): Promise<IOrderDocument[]> =>
  Order.find({}).sort('-createdAt');
