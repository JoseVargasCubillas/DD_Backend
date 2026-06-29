import { RequestHandler } from 'express';
import * as packageService from '../../organisms/services/package.service.js';
import { success, created, noContent, notFound, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

const handle = async (res: any, fn: () => Promise<any>, ok: 'success' | 'created' = 'success') => {
  try {
    const data = await fn();
    return ok === 'created' ? created(res, data) : success(res, data);
  } catch (err: any) {
    if (err.statusCode === 404) return notFound(res, err.message);
    if (err.statusCode === 400 || err.statusCode === 409) return badRequest(res, err.message);
    return serverError(res, err);
  }
};

export const list: RequestHandler = (_req, res) => handle(res, () => packageService.listPackages());
export const get: RequestHandler = (req, res) => handle(res, () => packageService.getPackage(req.params.id));
export const create: RequestHandler = (req, res) => handle(res, () => packageService.createPackage(req.body), 'created');
export const update: RequestHandler = (req, res) => handle(res, () => packageService.updatePackage(req.params.id, req.body));
export const remove: RequestHandler = async (req, res) => {
  try { await packageService.deletePackage(req.params.id); noContent(res); }
  catch (err: any) { err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err); }
};

export const assignToUser: RequestHandler = (req, res) =>
  handle(res, () => packageService.assignPackageToUser(req.params.userId, req.body.packageId));
