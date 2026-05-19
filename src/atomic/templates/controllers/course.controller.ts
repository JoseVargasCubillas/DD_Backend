import { RequestHandler } from 'express';
import * as courseService from '../../organisms/services/course.service.js';
import { success, created, paginated, notFound, serverError } from '../../atoms/helpers/response.helper.js';

export const create: RequestHandler = async (req, res) => {
  try {
    const course = await courseService.createCourse({ ...req.body, instructor: String((req as any).user._id) });
    created(res, course);
  } catch (err: any) { serverError(res, err); }
};

export const list: RequestHandler = async (req, res) => {
  try {
    const { page, limit, category, status, search } = req.query as Record<string, string>;
    const result = await courseService.listCourses({ page: +page || 1, limit: +limit || 12, category, status, search });
    paginated(res, result.courses, { total: result.total, page: result.page, pages: result.pages });
  } catch (err: any) { serverError(res, err); }
};

export const getBySlug: RequestHandler = async (req, res) => {
  try {
    const course = await courseService.getCourseBySlug(req.params.slug);
    success(res, course);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const update: RequestHandler = async (req, res) => {
  try {
    const course = await courseService.updateCourse(req.params.id, req.body);
    success(res, course);
  } catch (err: any) { serverError(res, err); }
};

export const remove: RequestHandler = async (req, res) => {
  try {
    await courseService.deleteCourse(req.params.id);
    success(res, { message: 'Course archived' });
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};
