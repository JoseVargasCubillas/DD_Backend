import mongoose, { Document, Schema } from 'mongoose';
import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';

interface OrderItem {
  type: 'course' | 'event' | 'subscription' | 'product';
  refId: mongoose.Types.ObjectId;
  title: string;
  price: number;
  quantity: number;
}

export interface IOrderDocument extends Document {
  user: mongoose.Types.ObjectId;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: string;
  stripePaymentIntentId: string;
  stripeReceiptUrl: string;
  paidAt?: Date;
  notes: string;
  createdAt: Date;
}

const orderSchema = new Schema<IOrderDocument>({
  user:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    type:     { type: String, enum: ['course', 'event', 'subscription', 'product'], required: true },
    refId:    { type: Schema.Types.ObjectId, required: true },
    title:    String,
    price:    Number,
    quantity: { type: Number, default: 1 },
  }],
  subtotal:              { type: Number, required: true },
  tax:                   { type: Number, default: 0 },
  total:                 { type: Number, required: true },
  currency:              { type: String, default: 'MXN' },
  status:                { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING },
  stripePaymentIntentId: { type: String, default: '' },
  stripeReceiptUrl:      { type: String, default: '' },
  paidAt:                { type: Date, default: null },
  notes:                 { type: String, default: '' },
}, { timestamps: true });

orderSchema.index({ user: 1, status: 1 });

export const Order = mongoose.model<IOrderDocument>('Order', orderSchema);
