import { RequestHandler } from 'express';
import * as userService from '../../organisms/services/user.service.js';
import { success, paginated, notFound, serverError } from '../../atoms/helpers/response.helper.js';

export const getProfile: RequestHandler = async (req, res) => {
  try {
    const user = await userService.getById(String((req as any).user._id));
    success(res, user);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const updateProfile: RequestHandler = async (req, res) => {
  try {
    const user = await userService.updateProfile(String((req as any).user._id), req.body);
    success(res, user);
  } catch (err: any) { serverError(res, err); }
};

export const listUsers: RequestHandler = async (req, res) => {
  try {
    const { page, limit, search } = req.query as Record<string, string>;
    const result = await userService.listUsers({ page: +page || 1, limit: +limit || 20, search });
    paginated(res, result.users, { total: result.total, page: result.page, pages: result.pages });
  } catch (err: any) { serverError(res, err); }
};

export const toggleActive: RequestHandler = async (req, res) => {
  try {
    const user = await userService.toggleActive(req.params.id);
    success(res, user);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};
