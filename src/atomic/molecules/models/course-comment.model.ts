import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface ICourseCommentDocument extends SqlDocumentMethods<ICourseCommentDocument> {
  courseId: string;
  lessonId: string;
  userId: string;
  body: string;
  status: 'published' | 'hidden';
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const CourseComment = createSqlModel<ICourseCommentDocument>({
  table: 'course_comments',
  defaults: () => ({
    lessonId: '',
    status: 'published',
  }),
});
