import slugify from 'slugify';
import { Course, ICourseDocument } from '../../molecules/models/course.model.js';
import { User } from '../../molecules/models/user.model.js';
import { COURSE_STATUS } from '../../atoms/constants/status.constant.js';

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });
const makeSlug = (title: string): string => slugify(title, { lower: true, strict: true });

interface CreateCourseInput {
  title: string; description: string; price: number; category: string;
  instructor: string; [key: string]: unknown;
}
interface ListCoursesParams { page?: number; limit?: number; category?: string; status?: string; search?: string }

export const createCourse = async (data: CreateCourseInput): Promise<ICourseDocument> => {
  const slug = makeSlug(data.title);
  if (await Course.findOne({ slug })) throw makeError('Course slug already exists', 409);
  return Course.create({ ...data, slug });
};

export const listCourses = async ({ page = 1, limit = 12, category, status, search }: ListCoursesParams) => {
  const query: Record<string, unknown> = { status: status ?? COURSE_STATUS.PUBLISHED };
  if (category) query.category = category;
  if (search) query.$text = { $search: search };

  const [courses, total] = await Promise.all([
    Course.find(query).populate('instructor', 'name avatar').skip((page - 1) * limit).limit(limit).sort('-createdAt'),
    Course.countDocuments(query),
  ]);
  return { courses, total, page, pages: Math.ceil(total / limit) };
};

export const getCourseBySlug = async (slug: string): Promise<ICourseDocument> => {
  const course = await Course.findOne({ slug }).populate('instructor', 'name avatar bio').populate('lessons');
  if (!course) throw makeError('Course not found', 404);
  return course;
};

export const updateCourse = async (id: string, data: Partial<ICourseDocument>): Promise<ICourseDocument | null> => {
  if (data.title) (data as any).slug = makeSlug(data.title);
  return Course.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

export const deleteCourse = async (id: string): Promise<ICourseDocument> => {
  const course = await Course.findByIdAndUpdate(id, { status: COURSE_STATUS.ARCHIVED }, { new: true });
  if (!course) throw makeError('Course not found', 404);
  return course;
};

export const enrollUser = async (courseId: string, userId: string): Promise<ICourseDocument | null> => {
  const [course] = await Promise.all([
    Course.findByIdAndUpdate(courseId, { $inc: { enrolledCount: 1 } }, { new: true }),
    User.findByIdAndUpdate(userId, { $addToSet: { enrolledCourses: courseId } }),
  ]);
  return course;
};
