import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface IPackageDocument extends SqlDocumentMethods<IPackageDocument> {
  name: string;
  slug: string;
  description: string;
  price: number;
  currency: string;
  courseIds: string[];
  durationDays: number;
  isActive: boolean;
  isFeatured: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Package = createSqlModel<IPackageDocument>({
  table: 'packages',
  defaults: () => ({
    description: '',
    price: 0,
    currency: 'MXN',
    courseIds: [],
    durationDays: 0,
    isActive: true,
    isFeatured: false,
  }),
});
