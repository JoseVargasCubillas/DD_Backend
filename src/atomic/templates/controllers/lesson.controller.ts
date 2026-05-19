import { RequestHandler } from 'express';
import * as lessonService from '../../organisms/services/lesson.service.js';
import { success, created, notFound, serverError } from '../../atoms/helpers/response.helper.js';

export const create: RequestHandler = async (req, res) => {
  try {
    const lesson = await lessonService.createLesson(req.params.courseId, req.body);
    created(res, lesson);
  } catch (err: any) { serverError(res, err); }
};

export const listByCourse: RequestHandler = async (req, res) => {
  try {
    const lessons = await lessonService.getLessonsByCourse(req.params.courseId);
    success(res, lessons);
  } catch (err: any) { serverError(res, err); }
};

export const getOne: RequestHandler = async (req, res) => {
  try {
    const lesson = await lessonService.getLessonById(req.params.id);
    success(res, lesson);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const update: RequestHandler = async (req, res) => {
  try {
    const lesson = await lessonService.updateLesson(req.params.id, req.body);
    success(res, lesson);
  } catch (err: any) { serverError(res, err); }
};

export const remove: RequestHandler = async (req, res) => {
  try {
    await lessonService.deleteLesson(req.params.id);
    success(res, { message: 'Lesson deleted' });
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};
