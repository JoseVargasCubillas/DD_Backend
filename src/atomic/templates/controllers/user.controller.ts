import { RequestHandler } from 'express';
import * as userService from '../../organisms/services/user.service.js';
import { success, paginated, notFound, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

export const getProfile: RequestHandler = async (req, res) => {
  try {
    const user = await userService.getByIdSanitized(String((req as any).user._id));
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
    const { page, limit, search, tagId, role, sort, segment } = req.query as Record<string, string>;
    const result = await userService.listUsers({
      page: +page || 1,
      limit: +limit || 20,
      search,
      tagId,
      role,
      sort,
      segment,
    });
    paginated(res, result.users, { total: result.total, page: result.page, pages: result.pages });
  } catch (err: any) { serverError(res, err); }
};

export const importContacts: RequestHandler = async (req, res) => {
  try {
    const result = await userService.importContacts({
      contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : [],
      productMappings: req.body?.productMappings ?? {},
    });
    success(res, result);
  } catch (err: any) {
    err.statusCode === 400 ? badRequest(res, err.message) : serverError(res, err);
  }
};

export const toggleActive: RequestHandler = async (req, res) => {
  try {
    const user = await userService.toggleActive(req.params.id);
    success(res, user);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

// ── Admin: vista detallada ───────────────────────────────────
export const getUserById: RequestHandler = async (req, res) => {
  try {
    const [user, tags, orders] = await Promise.all([
      userService.getByIdSanitized(req.params.id),
      userService.getUserTags(req.params.id),
      userService.getUserOrders(req.params.id),
    ]);
    success(res, { ...user, tags, orders });
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const adminUpdateUser: RequestHandler = async (req, res) => {
  try {
    const user = await userService.adminUpdateUser(req.params.id, req.body);
    success(res, user);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const assignTag: RequestHandler = async (req, res) => {
  const { tagId } = req.body as { tagId?: string };
  if (!tagId) { badRequest(res, 'tagId requerido'); return; }
  try {
    const tags = await userService.assignTag(req.params.id, tagId);
    success(res, tags);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const removeTag: RequestHandler = async (req, res) => {
  try {
    const tags = await userService.removeTag(req.params.id, req.params.tagId);
    success(res, tags);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const updateNotes: RequestHandler = async (req, res) => {
  try {
    const user = await userService.updateNotes(req.params.id, (req.body as any).notes ?? '');
    success(res, user);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const sendPasswordReset: RequestHandler = async (req, res) => {
  try {
    const result = await userService.sendPasswordReset(req.params.id);
    success(res, result);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};
