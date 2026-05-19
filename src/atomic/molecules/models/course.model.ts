import mongoose, { Document, Schema } from 'mongoose';
import { COURSE_STATUS } from '../../atoms/constants/status.constant.js';

export interface ICourseDocument extends Document {
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  thumbnail: string;
  previewVideo: string;
  price: number;
  salePrice?: number;
  currency: string;
  category: string;
  tags: string[];
  level: 'beginner' | 'intermediate' | 'advanced';
  language: string;
  status: string;
  instructor: mongoose.Types.ObjectId;
  lessons: mongoose.Types.ObjectId[];
  totalDuration: number;
  totalLessons: number;
  enrolledCount: number;
  rating: number;
  ratingsCount: number;
  stripePriceId: string;
  stripeProductId: string;
  isFeatured: boolean;
  requirements: string[];
  whatYouLearn: string[];
  createdAt: Date;
  updatedAt: Date;
}

const courseSchema = new Schema<ICourseDocument>({
  title:            { type: String, required: true, trim: true },
  slug:             { type: String, required: true, unique: true },
  description:      { type: String, required: true },
  shortDescription: { type: String, default: '' },
  thumbnail:        { type: String, default: '' },
  previewVideo:     { type: String, default: '' },
  price:            { type: Number, required: true, min: 0 },
  salePrice:        { type: Number, default: null },
  currency:         { type: String, default: 'MXN' },
  category:         { type: String, required: true },
  tags:             [String],
  level:            { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  language:         { type: String, default: 'es' },
  status:           { type: String, enum: Object.values(COURSE_STATUS), default: COURSE_STATUS.DRAFT },
  instructor:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lessons:          [{ type: Schema.Types.ObjectId, ref: 'Lesson' }],
  totalDuration:    { type: Number, default: 0 },
  totalLessons:     { type: Number, default: 0 },
  enrolledCount:    { type: Number, default: 0 },
  rating:           { type: Number, default: 0 },
  ratingsCount:     { type: Number, default: 0 },
  stripePriceId:    { type: String, default: '' },
  stripeProductId:  { type: String, default: '' },
  isFeatured:       { type: Boolean, default: false },
  requirements:     [String],
  whatYouLearn:     [String],
}, { timestamps: true });

courseSchema.index({ slug: 1 });
courseSchema.index({ status: 1, category: 1 });
courseSchema.index({ title: 'text', description: 'text' });

export const Course = mongoose.model<ICourseDocument>('Course', courseSchema);
