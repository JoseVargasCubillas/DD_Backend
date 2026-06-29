import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface ILessonDocument extends SqlDocumentMethods<ILessonDocument> {
  title: string;
  slug: string;
  course: string;
  moduleId: string;
  order: number;
  description: string;
  videoUrl: string;
  duration: number;
  content: string;
  resources: { name: string; url: string }[];
  isPreview: boolean;
  isFree: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Lesson = createSqlModel<ILessonDocument>({
  table: 'lessons',
  defaults: () => ({
    moduleId: '',
    description: '',
    videoUrl: '',
    duration: 0,
    content: '',
    resources: [],
    isPreview: false,
    isFree: false,
  }),
});
