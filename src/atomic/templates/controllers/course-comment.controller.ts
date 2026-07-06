import { RequestHandler } from 'express';
import * as commentService from '../../organisms/services/course-comment.service.js';
import { badRequest, created, forbidden, noContent, notFound, serverError, success } from '../../atoms/helpers/response.helper.js';

const handleError = (res: Parameters<RequestHandler>[1], err: any) => {
  if (err.statusCode === 400) return badRequest(res, err.message);
  if (err.statusCode === 403) return forbidden(res, err.message);
  if (err.statusCode === 404) return notFound(res, err.message);
  return serverError(res, err);
};

export const list: RequestHandler = async (req, res) => {
  try {
    const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : undefined;
    const comments = await commentService.listCourseComments(req.params.courseId, lessonId);
    success(res, comments);
  } catch (err: any) {
    handleError(res, err);
  }
};

export const create: RequestHandler = async (req, res) => {
  try {
    const comment = await commentService.createCourseComment({
      courseId: req.params.courseId,
      lessonId: typeof req.body?.lessonId === 'string' ? req.body.lessonId : '',
      userId: String((req as any).user._id),
      body: String(req.body?.body ?? req.body?.content ?? ''),
    });
    created(res, comment);
  } catch (err: any) {
    handleError(res, err);
  }
};

export const remove: RequestHandler = async (req, res) => {
  try {
    await commentService.deleteCourseComment(
      req.params.commentId,
      String((req as any).user._id),
      String((req as any).user.role),
    );
    noContent(res);
  } catch (err: any) {
    handleError(res, err);
  }
};
