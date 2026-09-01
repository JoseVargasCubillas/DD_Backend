import { PLANS } from '../../atoms/constants/plans.constant.js';
import { SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';
import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface ISubscriptionDocument extends SqlDocumentMethods<ISubscriptionDocument> {
  user: string;
  plan: string;
  offerId?: string;
  packageId?: string;
  // Order que originó esta compra pagada de Academia (Order de un solo pago,
  // ver grantAcademiaAccess en payment.service.ts). Vacío en accesos gratis
  // otorgados a mano (assignPackageToUser / importaciones).
  orderId?: string;
  status: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  currentPeriodStart: Date | string;
  currentPeriodEnd: Date | string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date | string | null;
  purchaseNotifiedAt?: Date | string | null;
  lastNotifiedInvoiceId?: string | null;
  renewalReminder7dSentAt?: Date | string | null;
  renewalReminder1dSentAt?: Date | string | null;
  // Token de un solo uso para el link de invitacion a WhatsApp (planes
  // business/master) — ver academia.routes.ts. Vacio si el plan no incluye
  // grupo de WhatsApp.
  whatsappInviteToken?: string | null;
  whatsappInviteUsedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Subscription = createSqlModel<ISubscriptionDocument>({
  table: 'subscriptions',
  defaults: () => ({
    plan: PLANS.FREE,
    offerId: '',
    packageId: '',
    orderId: '',
    status: SUBSCRIPTION_STATUS.ACTIVE,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    purchaseNotifiedAt: null,
    lastNotifiedInvoiceId: null,
    renewalReminder7dSentAt: null,
    renewalReminder1dSentAt: null,
    whatsappInviteToken: null,
    whatsappInviteUsedAt: null,
  }),
});
