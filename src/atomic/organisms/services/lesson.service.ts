import slugify from 'slugify';
import { Lesson, ILessonDocument } from '../../molecules/models/lesson.model.js';
import { Course } from '../../molecules/models/course.model.js';

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });

export const createLesson = async (courseId: string, data: Partial<ILessonDocument>): Promise<ILessonDocument> => {
  const slug = slugify(data.title as string, { lower: true, strict: true });
  const count = await Lesson.countDocuments({ course: courseId });
  const lesson = await Lesson.create({ ...data, course: courseId, slug, order: count + 1 });
  await Course.findByIdAndUpdate(courseId, { $push: { lessons: lesson._id }, $inc: { totalLessons: 1 } });
  return lesson;
};

export const getLessonsByCourse = async (courseId: string): Promise<ILessonDocument[]> =>
  Lesson.find({ course: courseId }).sort('order');

export const getLessonById = async (id: string): Promise<ILessonDocument> => {
  const lesson = await Lesson.findById(id).populate('course', 'title slug');
  if (!lesson) throw makeError('Lesson not found', 404);
  return lesson;
};

export const updateLesson = async (id: string, data: Partial<ILessonDocument>): Promise<ILessonDocument | null> =>
  Lesson.findByIdAndUpdate(id, data, { new: true, runValidators: true });

export const deleteLesson = async (id: string): Promise<ILessonDocument> => {
  const lesson = await Lesson.findByIdAndDelete(id);
  if (!lesson) throw makeError('Lesson not found', 404);
  await Course.findByIdAndUpdate(lesson.course, { $pull: { lessons: id }, $inc: { totalLessons: -1 } });
  return lesson;
};
