import mongoose, { Document, Schema } from 'mongoose';
import { SUBSCRIPTION_STATUS } from '../../atoms/constants/status.constant.js';
import { PLANS } from '../../atoms/constants/plans.constant.js';

export interface ISubscriptionDocument extends Document {
  user: mongoose.Types.ObjectId;
  plan: string;
  status: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  createdAt: Date;
}

const subscriptionSchema = new Schema<ISubscriptionDocument>({
  user:                  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  plan:                  { type: String, enum: Object.values(PLANS), required: true },
  status:                { type: String, enum: Object.values(SUBSCRIPTION_STATUS), default: SUBSCRIPTION_STATUS.ACTIVE },
  stripeSubscriptionId:  { type: String, required: true },
  stripePriceId:         { type: String, required: true },
  currentPeriodStart:    { type: Date, required: true },
  currentPeriodEnd:      { type: Date, required: true },
  cancelAtPeriodEnd:     { type: Boolean, default: false },
  canceledAt:            { type: Date, default: null },
}, { timestamps: true });

subscriptionSchema.index({ user: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 }, { unique: true });

export const Subscription = mongoose.model<ISubscriptionDocument>('Subscription', subscriptionSchema);
