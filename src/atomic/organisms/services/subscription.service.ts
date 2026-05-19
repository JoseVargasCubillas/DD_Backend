import { stripe } from '../../../config/stripe.js';
import { Subscription, ISubscriptionDocument } from '../../molecules/models/subscription.model.js';
import { User } from '../../molecules/models/user.model.js';
import { SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });

export const createSubscription = async (userId: string, priceId: string, plan: string) => {
  const user = await User.findById(userId);
  if (!user) throw makeError('User not found', 404);

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name });
    customerId = customer.id;
    await User.findByIdAndUpdate(userId, { stripeCustomerId: customerId });
  }

  const stripeSub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  });

  const sub = await Subscription.create({
    user: userId, plan, stripeSubscriptionId: stripeSub.id, stripePriceId: priceId,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
    currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
  });

  await User.findByIdAndUpdate(userId, { plan });
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
