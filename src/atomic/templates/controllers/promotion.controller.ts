import { RequestHandler } from 'express';
import * as promotionService from '../../organisms/services/promotion.service.js';
import { success, created, noContent, notFound, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

const handle = async (res: any, fn: () => Promise<any>, ok: 'success' | 'created' = 'success') => {
  try {
    const data = await fn();
    return ok === 'created' ? created(res, data) : success(res, data);
  } catch (err: any) {
    if (err.statusCode === 404 || err.statusCode === 410) return notFound(res, err.message);
    if (err.statusCode === 400 || err.statusCode === 409) return badRequest(res, err.message);
    return serverError(res, err);
  }
};

export const list: RequestHandler = (_req, res) => handle(res, () => promotionService.listPromotions());
export const create: RequestHandler = (req, res) => handle(res, () => promotionService.createPromotion(req.body), 'created');
export const update: RequestHandler = (req, res) => handle(res, () => promotionService.updatePromotion(req.params.id, req.body));
export const remove: RequestHandler = async (req, res) => {
  try { await promotionService.deletePromotion(req.params.id); noContent(res); }
  catch (err: any) { err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err); }
};
export const validate: RequestHandler = (req, res) => handle(res, () => promotionService.validatePromotion(req.params.code));
