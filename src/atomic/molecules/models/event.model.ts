import mongoose, { Document, Schema } from 'mongoose';
import { EVENT_STATUS } from '../../atoms/constants/status.constant.js';

export interface IEventDocument extends Document {
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  thumbnail: string;
  type: 'seminar' | 'workshop' | 'webinar' | 'conference';
  modality: 'in-person' | 'online' | 'hybrid';
  location: string;
  onlineUrl: string;
  startDate: Date;
  endDate: Date;
  price: number;
  salePrice?: number;
  capacity: number;
  registeredCount: number;
  status: string;
  instructor: mongoose.Types.ObjectId;
  attendees: mongoose.Types.ObjectId[];
  stripePriceId: string;
  isFeatured: boolean;
  agenda: { time: string; topic: string; speaker: string }[];
  createdAt: Date;
}

const eventSchema = new Schema<IEventDocument>({
  title:           { type: String, required: true, trim: true },
  slug:            { type: String, required: true, unique: true },
  description:     { type: String, required: true },
  shortDescription:{ type: String, default: '' },
  thumbnail:       { type: String, default: '' },
  type:            { type: String, enum: ['seminar', 'workshop', 'webinar', 'conference'], default: 'seminar' },
  modality:        { type: String, enum: ['in-person', 'online', 'hybrid'], default: 'in-person' },
  location:        { type: String, default: '' },
  onlineUrl:       { type: String, default: '' },
  startDate:       { type: Date, required: true },
  endDate:         { type: Date, required: true },
  price:           { type: Number, required: true, min: 0 },
  salePrice:       { type: Number, default: null },
  capacity:        { type: Number, default: 0 },
  registeredCount: { type: Number, default: 0 },
  status:          { type: String, enum: Object.values(EVENT_STATUS), default: EVENT_STATUS.UPCOMING },
  instructor:      { type: Schema.Types.ObjectId, ref: 'User' },
  attendees:       [{ type: Schema.Types.ObjectId, ref: 'User' }],
  stripePriceId:   { type: String, default: '' },
  isFeatured:      { type: Boolean, default: false },
  agenda:          [{ time: String, topic: String, speaker: String }],
}, { timestamps: true });

eventSchema.index({ slug: 1 });
eventSchema.index({ startDate: 1, status: 1 });

export const Event = mongoose.model<IEventDocument>('Event', eventSchema);
