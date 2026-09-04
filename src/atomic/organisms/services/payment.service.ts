import { stripe } from '../../../config/stripe.js';
import { env } from '../../../config/env.js';
import { Order, IOrderDocument, IOrderShippingAddress, IOrderContact } from '../../molecules/models/order.model.js';
import { Subscription } from '../../molecules/models/subscription.model.js';
import { User, IUserDocument } from '../../molecules/models/user.model.js';
import { Book } from '../../molecules/models/book.model.js';
import { Event } from '../../molecules/models/event.model.js';
import { ORDER_STATUS, SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';
import {
  sendAcademiaOrderNotice,
  sendAcademiaOrderReceipt,
  sendCredentials,
  sendEventOrderReceipt,
} from './email.service.js';
import { hashPassword, generateTempPassword } from '../../atoms/helpers/hash.helper.js';
import { getShippingRate, getShippingRates, generateShippingLabel, ShippingPackage } from './shipping.service.js';
import { findOfferByIdentity, isOfferActive } from './offer.service.js';
import { getCheckoutUser, CheckoutCustomer, markIncompletePayment, clearIncompletePayment } from './user.service.js';
import { issueWhatsappInviteToken, buildWhatsappInviteUrl } from './whatsapp-invite.service.js';
import Stripe from 'stripe';

interface OrderItemInput {
  type: string;
  refId: string;
  title: string;
  price: number;
  quantity?: number;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  offerId?: string;
  packageId?: string;
  plan?: string;
}
interface CheckoutContactInput { name?: string; email?: string; phone?: string }
interface ShippingSelectionInput { carrier?: string; service?: string }
const ACADEMIA_ACCESS_TYPES = new Set(['academia', 'offer']);
// Todo lo que se puede comprar sin sesion iniciada — cada uno crea/reutiliza
// una cuenta real (ver getCheckoutUser) en vez del guest-checkout viejo que
// solo guardaba un IOrderContact, para que el tag de "pago incompleto" y el
// resto del CRM tengan a quien colgarsele.
const GUEST_ACCOUNT_TYPES = new Set(['academia', 'offer', 'event', 'product']);

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
          weightKg: Number(book.weightKg || 0.5),
          lengthCm: Number(book.lengthCm || 23),
          widthCm: Number(book.widthCm || 16),
          heightCm: Number(book.heightCm || 3),
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

      if (ACADEMIA_ACCESS_TYPES.has(type)) {
        const refId = String(item.refId || '');
        const offer = await findOfferByIdentity(refId);
        if (!offer || offer.status === 'archived' || !isOfferActive(offer)) {
          throw makeError('Oferta no disponible', 400);
        }
        const packageId = offer.targetType === 'package' ? String(offer.targetId || '') : '';

        return {
          type: 'academia',
          refId: String(offer._id),
          title: offer.title,
          price: Number(offer.price),
          quantity: 1,
          offerId: String(offer._id),
          packageId,
          plan: String(offer.plan || 'pro'),
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

// Libros, eventos y Academia comprados sin sesion iniciada buscan-o-crean una
// cuenta real (ver getCheckoutUser) en vez del guest-checkout viejo que solo
// guardaba un IOrderContact — asi la compra aparece en "Mis pedidos" si esa
// persona despues inicia sesion, y el CRM (tags, contactStatus) tiene una
// cuenta real a la que colgarsele desde el primer intento de pago.
const resolveOrderOwner = async (
  userId: string | undefined,
  customer: CheckoutContactInput | undefined,
  requiresAccount: boolean,
): Promise<{ user: string; contact: IOrderContact | null }> => {
  if (requiresAccount) {
    const user: IUserDocument = await getCheckoutUser(userId, customer as CheckoutCustomer);
    return { user: String(user._id), contact: null };
  }
  if (userId) return { user: userId, contact: null };
  throw makeError('Inicia sesión para continuar', 401);
};

// Los libros del pedido se envian en el mismo sobre acolchado de 20x15cm que
// se usa siempre para este tipo de envio (ver paquete guardado "LIBROS" en
// Envia). Un sobre acolchado ya no cabe fisicamente pasado cierto peso, asi
// que pedidos grandes cambian a caja: el alto se apila por libro y largo/ancho
// toman el mayor de los items, igual que antes de introducir el sobre fijo.
const ENVELOPE_LENGTH_CM = 20;
const ENVELOPE_WIDTH_CM = 15;
const ENVELOPE_HEIGHT_CM = 2;
const ENVELOPE_MAX_WEIGHT_KG = 2;

const buildShippingPackages = (items: OrderItemInput[]): ShippingPackage[] => {
  const products = items.filter((i) => i.type === 'product');
  if (!products.length) return [];

  const totals = products.reduce(
    (acc, item) => {
      const quantity = item.quantity ?? 1;
      acc.weightKg += (item.weightKg ?? 0.5) * quantity;
      acc.heightCm += (item.heightCm ?? 3) * quantity;
      acc.lengthCm = Math.max(acc.lengthCm, item.lengthCm ?? 23);
      acc.widthCm = Math.max(acc.widthCm, item.widthCm ?? 16);
      acc.declaredValue += item.price * quantity;
      return acc;
    },
    { weightKg: 0, heightCm: 0, lengthCm: 0, widthCm: 0, declaredValue: 0 },
  );

  const weightKg = Math.round(totals.weightKg * 100) / 100;
  const content = products.map((p) => p.title).join(', ').slice(0, 100);
  const declaredValue = Math.round(totals.declaredValue * 100) / 100;
  const fitsEnvelope = weightKg <= ENVELOPE_MAX_WEIGHT_KG;

  return [
    {
      type: fitsEnvelope ? 'envelope' : 'box',
      content,
      weightKg,
      lengthCm: fitsEnvelope ? ENVELOPE_LENGTH_CM : totals.lengthCm,
      widthCm: fitsEnvelope ? ENVELOPE_WIDTH_CM : totals.widthCm,
      heightCm: fitsEnvelope ? ENVELOPE_HEIGHT_CM : Math.round(totals.heightCm * 100) / 100,
      declaredValue,
    },
  ];
};

// Antes solo mandaba recibo a compras de invitado (order.contact). Las
// compras de libros con sesion iniciada (order.user, sin contact) se
// quedaban sin ningun correo de confirmacion — se resuelve el destinatario
// contra el User cuando no hay contact de invitado.
const sendReceiptIfEventOrder = async (order: IOrderDocument): Promise<void> => {
  // Las ofertas de Academia ya mandan su propio recibo en grantAcademiaAccess
  // (sendAcademiaOrderReceipt) — si tambien se manda este generico, el cliente
  // recibe dos correos de "pago confirmado" para la misma compra.
  if (order.items.length > 0 && order.items.every((item) => item.type === 'academia')) return;

  const recipient = order.contact
    ? { name: order.contact.name, email: order.contact.email }
    : order.user
      ? await User.findById(order.user).then((user) => (user?.email ? { name: user.name || 'Cliente', email: user.email } : null))
      : null;
  if (!recipient) return;

  try {
    await sendEventOrderReceipt({ name: recipient.name, email: recipient.email, order });
  } catch (err) {
    console.warn('[sendReceiptIfEventOrder] failed:', (err as Error).message);
  }
};

// Best effort: si Envia falla, el pago ya esta confirmado y la orden sigue
// completa — no se bloquea la confirmacion por un problema de paqueteria.
// El admin puede reintentar manualmente si esto no genera la guia.
const generateOrderShippingLabelIfNeeded = async (order: IOrderDocument): Promise<void> => {
  if (!order.shipping || !order.shippingCarrier || !order.shippingService) return;
  if (order.shippingTrackingNumber) return;

  try {
    const packages = buildShippingPackages(order.items);
    if (!packages.length) return;
    const label = await generateShippingLabel(order.shipping, packages, order.shippingCarrier, order.shippingService);
    order.shippingTrackingNumber = label.trackingNumber;
    order.shippingLabelUrl = label.labelUrl;
    order.shippingTrackUrl = label.trackUrl;
    await order.save();
  } catch (err) {
    console.warn('[generateOrderShippingLabelIfNeeded] failed:', (err as Error).message);
  }
};

// Cotizacion en tiempo real para el paso de envio del checkout — se llama
// antes de crear el payment intent, para que el cliente elija carrier antes
// de pagar. Reusa normalizeOrderItems para validar los libros igual que
// createPaymentIntent (mismo catalogo autoritativo, nunca el que manda el cliente).
export const quoteShipping = async (items: OrderItemInput[], shipping: IOrderShippingAddress) => {
  const normalizedItems = await normalizeOrderItems(items);
  const packages = buildShippingPackages(normalizedItems);
  if (!packages.length) return [];
  return getShippingRates(shipping, packages);
};

// Pedidos con envío (productos físicos, ej. libros) calculan subtotal + envío + IVA por separado.
// Los pedidos existentes (cursos, suscripciones) conservan su comportamiento: el precio del item
// ya es el total a cobrar, sin desglose de impuestos, para no alterar montos ya en producción.
export const createPaymentIntent = async (
  userId: string | undefined,
  items: OrderItemInput[],
  shipping?: IOrderShippingAddress,
  customer?: CheckoutContactInput,
  shippingSelection?: ShippingSelectionInput,
) => {
  const normalizedItems = await normalizeOrderItems(items);
  const requiresAccount = normalizedItems.some((i) => GUEST_ACCOUNT_TYPES.has(i.type));
  const { user, contact } = await resolveOrderOwner(userId, customer, requiresAccount);
  const subtotal = normalizedItems.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0);
  const requiresShipping = Boolean(shipping) || normalizedItems.some((i) => i.type === 'product');

  // El envio ya esta incluido en el precio del libro — el costo real se paga
  // con el saldo de la cuenta de Envia, nunca se le cobra aparte al cliente.
  // Aun asi se valida server-side que el carrier+service elegido sea uno
  // real y vigente (mismo principio que el resto del catalogo autoritativo),
  // y se guarda para poder generar la guia cuando el pago se confirme.
  const shippingCost = 0;
  let shippingCarrier = '';
  let shippingService = '';
  if (requiresShipping && shipping && shippingSelection?.carrier && shippingSelection.service) {
    const packages = buildShippingPackages(normalizedItems);
    if (packages.length) {
      const rate = await getShippingRate(shipping, packages, shippingSelection.carrier, shippingSelection.service);
      shippingCarrier = rate.carrier;
      shippingService = rate.service;
    }
  }

  const tax = 0;
  const total = subtotal + tax;

  // Deja rastro en el contacto de que llego al paso de pago de un producto/
  // oferta especifico, sin esperar a que el pago se confirme — asi un lead
  // que abandona el checkout (o cuya tarjeta falla) no se ve como un lead
  // vacio, se ve como "Pago incompleto: <item>". Se quita en confirmPayment
  // (o abajo mismo en modo demo) si el pago si se confirma.
  const guestAccountItems = normalizedItems.filter((i) => GUEST_ACCOUNT_TYPES.has(i.type));
  for (const item of guestAccountItems) {
    await markIncompletePayment(user, item.title);
  }

  if (!isStripeConfigured()) {
    const demoPaymentIntentId = `demo_pi_${Date.now()}`;
    const order = await Order.create({
      user, contact, items: normalizedItems, subtotal, tax, shippingCost, shipping: shipping ?? null,
      shippingCarrier, shippingService, total,
      status: ORDER_STATUS.COMPLETED,
      stripePaymentIntentId: demoPaymentIntentId,
      paidAt: new Date(),
      notes: 'Pago confirmado en modo demo local por falta de llaves reales de Stripe.',
    });
    await sendReceiptIfEventOrder(order);
    await generateOrderShippingLabelIfNeeded(order);
    await grantAcademiaAccess(order);
    if (user) await User.findByIdAndUpdate(user, { contactStatus: 'customer' } as Partial<IUserDocument>);
    for (const item of guestAccountItems) await clearIncompletePayment(user, item.title);
    return { clientSecret: `demo_${order._id}`, orderId: order._id, subtotal, tax, shippingCost, total };
  }

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100),
    currency: 'mxn',
    metadata: { userId: user },
  });
  const order = await Order.create({
    user, contact, items: normalizedItems, subtotal, tax, shippingCost, shipping: shipping ?? null,
    shippingCarrier, shippingService, total,
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
  // La guia se genera antes del correo para que, si Envia responde a tiempo,
  // el recibo ya incluya el numero de rastreo — generateOrderShippingLabelIfNeeded
  // muta `saved` en el momento, no hace falta releer la orden.
  await generateOrderShippingLabelIfNeeded(saved);
  await sendReceiptIfEventOrder(saved);
  await grantAcademiaAccess(saved);
  if (saved.user) {
    // grantAcademiaAccess ya marca 'customer' para ofertas de Academia — este
    // flip cubre libros/eventos, que no pasan por ahi pero igual ahora tienen
    // una cuenta real (ver resolveOrderOwner) y deben dejar de verse como lead.
    await User.findByIdAndUpdate(saved.user, { contactStatus: 'customer' } as Partial<IUserDocument>);
    for (const item of saved.items.filter((i) => GUEST_ACCOUNT_TYPES.has(i.type))) {
      await clearIncompletePayment(saved.user, item.title);
    }
  }
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

// Otorga acceso a Academia y manda las notificaciones de compra. Se llama
// tanto para pagos reales (confirmPayment, tras el webhook payment_intent.succeeded)
// como para el modo demo local (createPaymentIntent sin llaves de Stripe) —
// ambos crean la orden ya COMPLETED, asi que la logica de acceso es la misma.
// Reusa la misma fila de Subscription en cada renovacion (busca por
// user+offerId) en vez de crear una nueva por compra, para no acumular
// historial duplicado y para que los flags de recordatorio se reseteen limpios.
const grantAcademiaAccess = async (order: IOrderDocument): Promise<void> => {
  const academiaItems = order.items.filter((item) => item.type === 'academia' && item.offerId);
  if (!academiaItems.length || !order.user) return;

  const user = await User.findById(String(order.user));
  if (!user?.email) return;

  for (const item of academiaItems) {
    const existing = await Subscription.findOne({ user: order.user, offerId: item.offerId });
    const isFirstPayment = !existing?.purchaseNotifiedAt;
    const currentPeriodStart = new Date();
    const currentPeriodEnd = new Date(currentPeriodStart.getTime() + ANNUAL_ACCESS_DAYS * DAY_MS);
    // Token nuevo en cada compra/renovacion (planes con grupo de WhatsApp) —
    // invalida cualquier link viejo que el cliente no haya usado todavia.
    const whatsappInviteToken = issueWhatsappInviteToken(item.plan || '');

    const subData = {
      user: order.user,
      plan: item.plan || 'pro',
      offerId: item.offerId || '',
      packageId: item.packageId || '',
      orderId: String(order._id),
      status: SUBSCRIPTION_STATUS.ACTIVE,
      stripeSubscriptionId: '',
      stripePriceId: '',
      currentPeriodStart: currentPeriodStart.toISOString(),
      currentPeriodEnd: currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      purchaseNotifiedAt: isFirstPayment ? new Date().toISOString() : existing?.purchaseNotifiedAt,
      renewalReminder7dSentAt: null,
      renewalReminder1dSentAt: null,
      whatsappInviteToken,
      whatsappInviteUsedAt: null,
    };

    const sub = existing
      ? await Subscription.findByIdAndUpdate(String(existing._id), subData)
      : await Subscription.create(subData as any);
    if (!sub) continue;

    await User.findByIdAndUpdate(String(user._id), { contactStatus: 'customer', plan: item.plan || 'pro' });

    const payload = {
      orderId: String(order._id),
      customerId: String(user._id || user.id || ''),
      customerName: user.name || 'Cliente',
      customerEmail: user.email,
      customerPhone: user.phone || '',
      plan: item.plan || 'pro',
      amountPaid: item.price,
      accessUntil: currentPeriodEnd,
      isRenewal: !isFirstPayment,
      receiptUrl: `${env.clientUrl}/recibo/pedido/${order._id}`,
      whatsappJoinUrl: whatsappInviteToken ? buildWhatsappInviteUrl(whatsappInviteToken) : undefined,
    };

    const emailsToSend = [sendAcademiaOrderNotice(payload), sendAcademiaOrderReceipt(payload)];

    // Cuentas de invitado se crean sin password utilizable (ver getCheckoutUser
    // en user.service.ts). Aqui, ya con el pago confirmado, se genera la
    // contrasena temporal real y se manda por correo junto con las otras dos.
    // Solo aplica al primer pago: si ya tiene password, ya recibio su correo antes.
    if (isFirstPayment && !user.password) {
      const tempPassword = generateTempPassword();
      await User.findByIdAndUpdate(String(user._id), { password: await hashPassword(tempPassword), mustChangePassword: true });
      emailsToSend.push(sendCredentials({ name: user.name, email: user.email }, tempPassword, { isNew: true }));
    }

    await Promise.all(emailsToSend);
  }
};

export const handleWebhook = async (event: Stripe.Event): Promise<void> => {
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await confirmPayment(paymentIntent.id);
  }
};

export const getOrdersByUser = async (userId: string): Promise<IOrderDocument[]> =>
  Order.find({ user: userId }).sort('-createdAt');

export const getAllOrders = async (): Promise<IOrderDocument[]> =>
  Order.find({}).sort('-createdAt');
