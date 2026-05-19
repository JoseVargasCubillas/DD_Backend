import mongoose, { Document, Schema } from 'mongoose';

export interface IBlogDocument extends Document {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  thumbnail: string;
  author: mongoose.Types.ObjectId;
  category: string;
  tags: string[];
  status: 'draft' | 'published' | 'archived';
  publishedAt?: Date;
  readTime: number;
  viewsCount: number;
  isFeatured: boolean;
  seo: { metaTitle: string; metaDescription: string; keywords: string[] };
  createdAt: Date;
  updatedAt: Date;
}

const blogSchema = new Schema<IBlogDocument>({
  title:       { type: String, required: true, trim: true },
  slug:        { type: String, required: true, unique: true },
  content:     { type: String, required: true },
  excerpt:     { type: String, default: '' },
  thumbnail:   { type: String, default: '' },
  author:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
  category:    { type: String, required: true },
  tags:        [String],
  status:      { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  publishedAt: { type: Date, default: null },
  readTime:    { type: Number, default: 0 },
  viewsCount:  { type: Number, default: 0 },
  isFeatured:  { type: Boolean, default: false },
  seo: {
    metaTitle:       { type: String, default: '' },
    metaDescription: { type: String, default: '' },
    keywords:        [String],
  },
}, { timestamps: true });

blogSchema.index({ slug: 1 });
blogSchema.index({ status: 1, publishedAt: -1 });
blogSchema.index({ title: 'text', content: 'text' });

export const Blog = mongoose.model<IBlogDocument>('Blog', blogSchema);
