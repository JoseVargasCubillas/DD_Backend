import { RequestHandler } from 'express';
import * as tagService from '../../organisms/services/tag.service.js';
import { success, created, badRequest, notFound, serverError, noContent } from '../../atoms/helpers/response.helper.js';

export const list: RequestHandler = async (_req, res) => {
  try {
    const tags = await tagService.listTags();
    const withCounts = await Promise.all(
      tags.map(async (t) => ({
        _id: t._id,
        id: t._id,
        name: t.name,
        slug: t.slug,
        color: t.color,
        description: t.description,
        contactsCount: await tagService.countUsersByTag(String(t._id)),
        createdAt: t.createdAt,
      })),
    );
    success(res, withCounts);
  } catch (err: any) { serverError(res, err); }
};

export const create: RequestHandler = async (req, res) => {
  try {
    const tag = await tagService.createTag(req.body);
    created(res, tag);
  } catch (err: any) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    if (err.statusCode === 409) return badRequest(res, err.message);
    serverError(res, err);
  }
};

export const update: RequestHandler = async (req, res) => {
  try {
    const tag = await tagService.updateTag(req.params.id, req.body);
    success(res, tag);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const remove: RequestHandler = async (req, res) => {
  try {
    await tagService.deleteTag(req.params.id);
    noContent(res);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};
