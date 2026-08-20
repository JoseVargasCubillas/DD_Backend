import { PLANS } from '../../atoms/constants/plans.constant.js';
import { SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';
import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface ISubscriptionDocument extends SqlDocumentMethods<ISubscriptionDocument> {
  user: string;
  plan: string;
  status: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  currentPeriodStart: Date | string;
  currentPeriodEnd: Date | string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date | string | null;
  purchaseNotifiedAt?: Date | string | null;
  lastNotifiedInvoiceId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Subscription = createSqlModel<ISubscriptionDocument>({
  table: 'subscriptions',
  defaults: () => ({
    plan: PLANS.FREE,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    purchaseNotifiedAt: null,
    lastNotifiedInvoiceId: null,
  }),
});
