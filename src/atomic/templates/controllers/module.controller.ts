import { RequestHandler } from 'express';
import * as moduleService from '../../organisms/services/module.service.js';
import { success, created, noContent, notFound, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

const handle = async (res: any, fn: () => Promise<any>, ok: 'success' | 'created' = 'success') => {
  try {
    const data = await fn();
    if (ok === 'created') return created(res, data);
    return success(res, data);
  } catch (err: any) {
    if (err.statusCode === 404) return notFound(res, err.message);
    if (err.statusCode === 400) return badRequest(res, err.message);
    return serverError(res, err);
  }
};

export const listByCourse: RequestHandler = (req, res) =>
  handle(res, () => moduleService.listModulesByCourse(req.params.courseId));

export const create: RequestHandler = (req, res) =>
  handle(res, () => moduleService.createModule(req.params.courseId, req.body), 'created');

export const update: RequestHandler = (req, res) =>
  handle(res, () => moduleService.updateModule(req.params.id, req.body));

export const remove: RequestHandler = async (req, res) => {
  try {
    await moduleService.deleteModule(req.params.id);
    noContent(res);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const reorder: RequestHandler = (req, res) =>
  handle(res, () => moduleService.reorderModules(req.params.courseId, req.body.orderedIds || []));

export const addLesson: RequestHandler = (req, res) =>
  handle(res, () => moduleService.addLessonToModule(req.params.id, req.body), 'created');

export const lessonsByModule: RequestHandler = (req, res) =>
  handle(res, () => moduleService.listLessonsByModule(req.params.id));
