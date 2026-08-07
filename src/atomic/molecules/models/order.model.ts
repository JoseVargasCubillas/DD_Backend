import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';
import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

interface OrderItem {
  type: 'course' | 'event' | 'subscription' | 'product' | string;
  refId: string;
  title: string;
  price: number;
  quantity?: number;
}

export interface IOrderShippingAddress {
  fullName: string;
  phone: string;
  street: string;
  colony: string;
  postalCode: string;
  city: string;
  state: string;
  references?: string;
}

export interface IOrderDocument extends SqlDocumentMethods<IOrderDocument> {
  user: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  shippingCost: number;
  shipping: IOrderShippingAddress | null;
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
    shippingCost: 0,
    shipping: null,
    currency: 'MXN',
    status: ORDER_STATUS.PENDING,
    stripePaymentIntentId: '',
    stripeReceiptUrl: '',
    paidAt: null,
    notes: '',
  }),
});
