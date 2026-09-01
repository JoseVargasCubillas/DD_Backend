import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';
import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

interface OrderItem {
  type: 'course' | 'event' | 'subscription' | 'product' | string;
  refId: string;
  title: string;
  price: number;
  quantity?: number;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
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

export interface IOrderContact {
  name: string;
  email: string;
  phone: string;
}

export interface IOrderDocument extends SqlDocumentMethods<IOrderDocument> {
  user?: string;
  contact: IOrderContact | null;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  shippingCost: number;
  shipping: IOrderShippingAddress | null;
  // Carrier+service elegidos por el cliente en el checkout (cotizado con
  // Envia). Se usan para generar la guia real una vez que el pago se
  // confirma — ver confirmPayment en payment.service.ts.
  shippingCarrier: string;
  shippingService: string;
  shippingTrackingNumber: string;
  shippingLabelUrl: string;
  shippingTrackUrl: string;
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
    contact: null,
    tax: 0,
    shippingCost: 0,
    shipping: null,
    shippingCarrier: '',
    shippingService: '',
    shippingTrackingNumber: '',
    shippingLabelUrl: '',
    shippingTrackUrl: '',
    currency: 'MXN',
    status: ORDER_STATUS.PENDING,
    stripePaymentIntentId: '',
    stripeReceiptUrl: '',
    paidAt: null,
    notes: '',
  }),
});
