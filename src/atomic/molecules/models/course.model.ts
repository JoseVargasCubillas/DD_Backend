import { COURSE_STATUS } from '../../atoms/constants/status.constant.js';
import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface ICourseDocument extends SqlDocumentMethods<ICourseDocument> {
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  thumbnail: string;
  previewVideo: string;
  price: number;
  salePrice?: number | null;
  currency: string;
  category: string;
  tags: string[];
  level: 'beginner' | 'intermediate' | 'advanced';
  language: string;
  status: string;
  instructor: string;
  lessons: string[];
  modules: string[];
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
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Course = createSqlModel<ICourseDocument>({
  table: 'courses',
  defaults: () => ({
    shortDescription: '',
    thumbnail: '',
    previewVideo: '',
    salePrice: null,
    currency: 'MXN',
    tags: [],
    level: 'beginner',
    language: 'es',
    status: COURSE_STATUS.DRAFT,
    lessons: [],
    modules: [],
    totalDuration: 0,
    totalLessons: 0,
    enrolledCount: 0,
    rating: 0,
    ratingsCount: 0,
    stripePriceId: '',
    stripeProductId: '',
    isFeatured: false,
    requirements: [],
    whatYouLearn: [],
  }),
});
