import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface IModuleDocument extends SqlDocumentMethods<IModuleDocument> {
  courseId: string;
  title: string;
  slug: string;
  description: string;
  order: number;
  lessonIds: string[];
  isPublished: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Module = createSqlModel<IModuleDocument>({
  table: 'modules',
  defaults: () => ({
    description: '',
    order: 0,
    lessonIds: [],
    isPublished: true,
  }),
});
