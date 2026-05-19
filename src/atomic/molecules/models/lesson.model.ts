import mongoose, { Document, Schema } from 'mongoose';

export interface ILessonDocument extends Document {
  title: string;
  slug: string;
  course: mongoose.Types.ObjectId;
  order: number;
  description: string;
  videoUrl: string;
  duration: number;
  content: string;
  resources: { name: string; url: string }[];
  isPreview: boolean;
  isFree: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const lessonSchema = new Schema<ILessonDocument>({
  title:       { type: String, required: true, trim: true },
  slug:        { type: String, required: true },
  course:      { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  order:       { type: Number, required: true },
  description: { type: String, default: '' },
  videoUrl:    { type: String, default: '' },
  duration:    { type: Number, default: 0 },
  content:     { type: String, default: '' },
  resources:   [{ name: String, url: String }],
  isPreview:   { type: Boolean, default: false },
  isFree:      { type: Boolean, default: false },
}, { timestamps: true });

lessonSchema.index({ course: 1, order: 1 });

export const Lesson = mongoose.model<ILessonDocument>('Lesson', lessonSchema);
