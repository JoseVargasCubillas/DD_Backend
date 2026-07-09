import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export type OfferContentAccess = 'full' | 'modules';
export type OfferType = 'standard' | 'trial';
export type OfferStatus = 'draft' | 'published' | 'archived';

export interface IOfferContentItem {
  courseId: string;
  access: OfferContentAccess;
  moduleIds: string[];
}

export interface IOfferDocument extends SqlDocumentMethods<IOfferDocument> {
  title: string;
  slug: string;
  description: string;
  type: OfferType;
  status: OfferStatus;
  price: number;
  currency: string;
  paymentType?: 'one_time' | 'subscription' | 'free';
  stripePriceId?: string;
  plan?: string;
  content: IOfferContentItem[];
  assignedUserIds: string[];
  startsAt?: Date | string | null;
  expiresAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Offer = createSqlModel<IOfferDocument>({
  table: 'offers',
  defaults: () => ({
    description: '',
    type: 'standard',
    status: 'draft',
    price: 0,
    currency: 'MXN',
    paymentType: 'one_time',
    stripePriceId: '',
    plan: 'pro',
    content: [],
    assignedUserIds: [],
    startsAt: null,
    expiresAt: null,
  }),
});
