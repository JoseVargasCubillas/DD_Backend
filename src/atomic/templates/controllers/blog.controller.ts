import { RequestHandler } from 'express';
import * as blogService from '../../organisms/services/blog.service.js';
import * as draftsService from '../../organisms/services/blog-drafts.service.js';
import { success, created, paginated, notFound, serverError } from '../../atoms/helpers/response.helper.js';

export const create: RequestHandler = async (req, res) => {
  try {
    const post = await blogService.createPost({ ...req.body, author: (req as any).user._id });
    created(res, post);
  } catch (err: any) { serverError(res, err); }
};

export const list: RequestHandler = async (req, res) => {
  try {
    const { page, limit, category, search, status } = req.query as Record<string, string>;
    const result = await blogService.listPosts({ page: +page || 1, limit: +limit || 10, category, search, status });
    paginated(res, result.posts, { total: result.total, page: result.page, pages: result.pages });
  } catch (err: any) { serverError(res, err); }
};

export const getBySlug: RequestHandler = async (req, res) => {
  try {
    const post = await blogService.getPostBySlug(req.params.slug);
    success(res, post);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const update: RequestHandler = async (req, res) => {
  try {
    const post = await blogService.updatePost(req.params.id, req.body);
    success(res, post);
  } catch (err: any) { serverError(res, err); }
};

export const remove: RequestHandler = async (req, res) => {
  try {
    await blogService.deletePost(req.params.id);
    success(res, { message: 'Post archived' });
  } catch (err: any) { serverError(res, err); }
};

/**
 * Genera N drafts en el pool de blog posts. Payload:
 *   { count?: number = 3, useAI?: boolean = true }
 * Solo accesible con requireAdmin (montado en las rutas).
 */
export const generateDrafts: RequestHandler = async (req, res) => {
  try {
    const count = Math.min(Math.max(Number(req.body?.count) || 3, 1), 10);
    const useAI = req.body?.useAI !== false;
    const posts = await draftsService.generateDrafts(count, { useAI });
    created(res, { count: posts.length, drafts: posts });
  } catch (err: any) { serverError(res, err); }
};

export const listDrafts: RequestHandler = async (req, res) => {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const result = await draftsService.listDrafts({
      page: +page || 1,
      limit: +limit || 20,
    });
    paginated(res, result.posts, { total: result.total, page: result.page, pages: result.pages });
  } catch (err: any) { serverError(res, err); }
};

export const publishDraft: RequestHandler = async (req, res) => {
  try {
    const post = await blogService.updatePost(req.params.id, {
      status: 'published',
      publishedAt: new Date(),
    });
    if (!post) return notFound(res, 'Draft not found');
    success(res, post);
  } catch (err: any) { serverError(res, err); }
};
