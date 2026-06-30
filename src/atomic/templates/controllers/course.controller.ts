import { RequestHandler } from 'express';
import * as courseService from '../../organisms/services/course.service.js';
import * as driveImportService from '../../organisms/services/drive-import.service.js';
import { success, created, paginated, notFound, serverError, badRequest } from '../../atoms/helpers/response.helper.js';

export const create: RequestHandler = async (req, res) => {
  try {
    const course = await courseService.createCourse({ ...req.body, instructor: String((req as any).user._id) });
    created(res, course);
  } catch (err: any) { serverError(res, err); }
};

export const importFromDrive: RequestHandler = async (req, res) => {
  try {
    const folderUrl = typeof req.body?.folderUrl === 'string' ? req.body.folderUrl.trim() : '';
    if (folderUrl) {
      const result = await driveImportService.importDriveFolder({
        folderUrl,
        instructor: String((req as any).user._id),
        status: req.body?.status,
        resetExisting: req.body?.resetExisting === true,
      });
      success(res, result);
      return;
    }

    const courses = Array.isArray(req.body?.courses) ? req.body.courses : [];
    if (!courses.length) {
      badRequest(res, 'folderUrl o courses es requerido');
      return;
    }
    const result = await driveImportService.importDriveCourses({
      courses,
      instructor: String((req as any).user._id),
      status: req.body?.status,
      resetExisting: req.body?.resetExisting === true,
    });
    success(res, result);
  } catch (err: any) { serverError(res, err); }
};

export const previewDriveImport: RequestHandler = async (req, res) => {
  try {
    const folderUrl = typeof req.body?.folderUrl === 'string' ? req.body.folderUrl.trim() : '';
    if (!folderUrl) {
      badRequest(res, 'folderUrl es requerido');
      return;
    }
    const result = await driveImportService.previewDriveFolder(folderUrl);
    success(res, result);
  } catch (err: any) { serverError(res, err); }
};

export const list: RequestHandler = async (req, res) => {
  try {
    const { page, limit, category, status, search, includeAll } = req.query as Record<string, string>;
    const result = await courseService.listCourses({
      page: +page || 1,
      limit: +limit || 12,
      category,
      status,
      search,
      includeAll: includeAll === 'true',
    });
    paginated(res, result.courses, { total: result.total, page: result.page, pages: result.pages });
  } catch (err: any) { serverError(res, err); }
};

export const getByIdAdmin: RequestHandler = async (req, res) => {
  try {
    const course = await courseService.getCourseByIdWithModules(req.params.id);
    success(res, course);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const getBySlug: RequestHandler = async (req, res) => {
  try {
    const course = await courseService.getCourseBySlug(req.params.slug, (req as any).user?._id);
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
