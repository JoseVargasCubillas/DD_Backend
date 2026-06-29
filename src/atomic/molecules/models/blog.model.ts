import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface IBlogDocument extends SqlDocumentMethods<IBlogDocument> {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  thumbnail: string;
  author: string;
  category: string;
  tags: string[];
  status: 'draft' | 'published' | 'archived';
  publishedAt?: Date | string | null;
  readTime: number;
  viewsCount: number;
  isFeatured: boolean;
  seo: { metaTitle: string; metaDescription: string; keywords: string[] };
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Blog = createSqlModel<IBlogDocument>({
  table: 'blog_posts',
  defaults: () => ({
    excerpt: '',
    thumbnail: '',
    tags: [],
    status: 'draft',
    publishedAt: null,
    readTime: 0,
    viewsCount: 0,
    isFeatured: false,
    seo: { metaTitle: '', metaDescription: '', keywords: [] },
  }),
});
