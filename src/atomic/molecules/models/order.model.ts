import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';
import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

interface OrderItem {
  type: 'course' | 'event' | 'subscription' | 'product' | string;
  refId: string;
  title: string;
  price: number;
  quantity?: number;
}

export interface IOrderDocument extends SqlDocumentMethods<IOrderDocument> {
  user: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: string;
  stripePaymentIntentId: string;
  stripeReceiptUrl: string;
  paidAt?: Date | string | null;
  notes: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Order = createSqlModel<IOrderDocument>({
  table: 'orders',
  defaults: () => ({
    items: [],
    tax: 0,
    currency: 'MXN',
    status: ORDER_STATUS.PENDING,
    stripePaymentIntentId: '',
    stripeReceiptUrl: '',
    paidAt: null,
    notes: '',
  }),
});
