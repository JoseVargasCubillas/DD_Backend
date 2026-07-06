import { Course } from '../../molecules/models/course.model.js';
import { CourseComment, ICourseCommentDocument } from '../../molecules/models/course-comment.model.js';
import { Lesson } from '../../molecules/models/lesson.model.js';
import { User } from '../../molecules/models/user.model.js';

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });

const resolveCourse = async (courseId: string) => {
  const byId = await Course.findById(courseId);
  if (byId) return byId;
  return Course.findOne({ slug: courseId });
};

const publicComment = async (comment: ICourseCommentDocument) => {
  const [author, lesson] = await Promise.all([
    User.findById(comment.userId).select('-password'),
    comment.lessonId ? Lesson.findById(comment.lessonId) : Promise.resolve(null),
  ]);

  return {
    _id: comment._id,
    id: comment.id,
    courseId: comment.courseId,
    lessonId: comment.lessonId,
    userId: comment.userId,
    body: comment.body,
    status: comment.status,
    author: author
      ? {
          _id: author._id,
          id: author.id,
          name: author.name,
          email: author.email,
          avatar: author.avatar,
          role: author.role,
        }
      : null,
    lesson: lesson
      ? {
          _id: lesson._id,
          id: lesson.id,
          title: lesson.title,
          order: lesson.order,
        }
      : null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
};

export const listCourseComments = async (courseId: string, lessonId?: string) => {
  const course = await resolveCourse(courseId);
  if (!course) throw makeError('Course not found', 404);

  const query: Record<string, string> = { courseId: course._id };
  if (lessonId) query.lessonId = lessonId;

  const comments = await CourseComment.find(query).sort('createdAt');
  return Promise.all(comments.map(publicComment));
};

export const createCourseComment = async ({
  courseId,
  lessonId = '',
  userId,
  body,
}: {
  courseId: string;
  lessonId?: string;
  userId: string;
  body: string;
}) => {
  const course = await resolveCourse(courseId);
  if (!course) throw makeError('Course not found', 404);

  const cleanBody = body.trim();
  if (!cleanBody) throw makeError('Comentario requerido', 400);

  if (lessonId) {
    const lesson = await Lesson.findById(lessonId);
    if (!lesson || lesson.course !== course._id) throw makeError('Leccion no encontrada', 404);
    const visibility = (lesson as any).commentsVisibility;
    if (visibility === 'hidden' || visibility === 'locked') {
      throw makeError('Comentarios cerrados para esta leccion', 403);
    }
  }

  const comment = await CourseComment.create({
    courseId: course._id,
    lessonId,
    userId,
    body: cleanBody,
    status: 'published',
  });

  return publicComment(comment);
};

export const deleteCourseComment = async (commentId: string, userId: string, role: string) => {
  const comment = await CourseComment.findById(commentId);
  if (!comment) throw makeError('Comentario no encontrado', 404);
  if (comment.userId !== userId && role !== 'admin') throw makeError('No puedes eliminar este comentario', 403);
  await CourseComment.findByIdAndDelete(comment._id);
};
