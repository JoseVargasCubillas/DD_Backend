import { stripe } from '../../../config/stripe.js';
import { Subscription, ISubscriptionDocument } from '../../molecules/models/subscription.model.js';
import { User, IUserDocument } from '../../molecules/models/user.model.js';
import { Offer } from '../../molecules/models/offer.model.js';
import { SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });

type CheckoutItemRef = {
  type?: string;
  refId?: string;
  quantity?: number;
};

type CheckoutCustomer = {
  name?: string;
  email?: string;
  phone?: string;
};

type CreateSubscriptionInput = {
  userId?: string;
  priceId?: string;
  plan?: string;
  item?: CheckoutItemRef;
  customer?: CheckoutCustomer;
};

type ResolvedSubscriptionItem = {
  priceId: string;
  plan: string;
  title: string;
  offerId?: string;
};

const normalizeCustomer = (customer?: CheckoutCustomer): Required<CheckoutCustomer> => {
  const name = String(customer?.name || '').trim();
  const email = String(customer?.email || '').trim().toLowerCase();
  const phone = String(customer?.phone || '').trim();
  if (name.length < 2) throw makeError('Nombre requerido', 400);
  if (!/\S+@\S+\.\S+/.test(email)) throw makeError('Correo electronico invalido', 400);
  if (phone.length < 8) throw makeError('Telefono requerido', 400);
  return { name, email, phone };
};

const getCheckoutUser = async (userId?: string, customer?: CheckoutCustomer): Promise<IUserDocument> => {
  const normalized = normalizeCustomer(customer);

  if (userId) {
    const user = await User.findById(userId);
    if (!user) throw makeError('User not found', 404);
    user.name = normalized.name;
    user.email = normalized.email;
    user.phone = normalized.phone;
    await user.save();
    return user;
  }

  const existing = await User.findOne({ email: normalized.email });
  if (existing) {
    existing.name = normalized.name;
    existing.phone = normalized.phone;
    existing.contactStatus = existing.contactStatus || 'lead';
    await existing.save();
    return existing;
  }

  return User.create({
    name: normalized.name,
    email: normalized.email,
    phone: normalized.phone,
    password: '',
    role: 'user',
    plan: 'guest',
    notes: 'Cliente registrado desde checkout publico de Academia.',
    contactStatus: 'lead',
    marketingStatus: 'subscribed',
    isActive: true,
    isEmailVerified: false,
  } as Partial<IUserDocument>);
};

const findOfferByIdentity = async (refId: string) => {
  const byId = await Offer.findById(refId);
  if (byId) return byId;
  const bySlug = await Offer.findOne({ slug: refId });
  if (bySlug) return bySlug;
  return Offer.findOne({ id: refId } as any);
};

const resolveSubscriptionItem = async (input: CreateSubscriptionInput): Promise<ResolvedSubscriptionItem> => {
  if (input.item?.refId) {
    const type = String(input.item.type || 'offer').toLowerCase();
    if (type !== 'offer' && type !== 'subscription') throw makeError('Tipo de suscripcion no soportado', 400);

    const offer = await findOfferByIdentity(String(input.item.refId));
    if (!offer || offer.status === 'archived') throw makeError('Oferta no disponible', 400);

    const paymentType = (offer as any).paymentType || 'subscription';
    if (paymentType !== 'subscription') throw makeError('Esta oferta no es una suscripcion', 400);

    const stripePriceId = String((offer as any).stripePriceId || '');
    if (!stripePriceId.startsWith('price_')) {
      throw makeError(`Configura stripePriceId=price_... en la oferta ${offer.title}`, 400);
    }

    return {
      priceId: stripePriceId,
      plan: String((offer as any).plan || input.plan || 'pro'),
      title: offer.title,
      offerId: offer._id,
    };
  }

  if (!input.priceId?.startsWith('price_')) throw makeError('priceId requerido', 400);
  return { priceId: input.priceId, plan: input.plan || 'pro', title: input.plan || 'Suscripcion' };
};

export const createSubscription = async (input: CreateSubscriptionInput) => {
  const customer = normalizeCustomer(input.customer);
  const user = await getCheckoutUser(input.userId, customer);
  const item = await resolveSubscriptionItem(input);

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const stripeCustomer = await stripe.customers.create({
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      metadata: { userId: user._id },
    });
    customerId = stripeCustomer.id;
    await User.findByIdAndUpdate(user._id, { stripeCustomerId: customerId });
  } else {
    await stripe.customers.update(customerId, {
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
    });
  }

  const stripeSub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: item.priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
    metadata: {
      userId: user._id,
      plan: item.plan,
      offerId: item.offerId || '',
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
    },
  });

  const sub = await Subscription.create({
    user: user._id, plan: item.plan, stripeSubscriptionId: stripeSub.id, stripePriceId: item.priceId,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
    currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
  });

  await User.findByIdAndUpdate(user._id, { plan: item.plan });

  const invoice = stripeSub.latest_invoice as any;
  return { subscription: sub, clientSecret: invoice?.payment_intent?.client_secret ?? '' };
};

export const cancelSubscription = async (userId: string): Promise<ISubscriptionDocument> => {
  const sub = await Subscription.findOne({ user: userId, status: SUBSCRIPTION_STATUS.ACTIVE });
  if (!sub) throw makeError('No active subscription', 404);
  await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
  sub.cancelAtPeriodEnd = true;
  return sub.save();
};

export const getActiveSubscription = async (userId: string): Promise<ISubscriptionDocument | null> =>
  Subscription.findOne({ user: userId, status: SUBSCRIPTION_STATUS.ACTIVE });
