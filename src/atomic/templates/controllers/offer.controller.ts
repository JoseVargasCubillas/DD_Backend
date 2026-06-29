import { RequestHandler } from 'express';
import * as offerService from '../../organisms/services/offer.service.js';
import { badRequest, created, notFound, serverError, success } from '../../atoms/helpers/response.helper.js';

export const list: RequestHandler = async (_req, res) => {
  try {
    success(res, await offerService.listOffers());
  } catch (err: any) { serverError(res, err); }
};

export const get: RequestHandler = async (req, res) => {
  try {
    success(res, await offerService.getOffer(req.params.id));
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const create: RequestHandler = async (req, res) => {
  try {
    created(res, await offerService.createOffer(req.body));
  } catch (err: any) {
    err.statusCode === 400 ? badRequest(res, err.message) : serverError(res, err);
  }
};

export const update: RequestHandler = async (req, res) => {
  try {
    success(res, await offerService.updateOffer(req.params.id, req.body));
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : err.statusCode === 400 ? badRequest(res, err.message) : serverError(res, err);
  }
};

export const remove: RequestHandler = async (req, res) => {
  try {
    success(res, await offerService.deleteOffer(req.params.id));
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const assign: RequestHandler = async (req, res) => {
  const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : req.body?.userId ? [String(req.body.userId)] : [];
  if (!userIds.length) {
    badRequest(res, 'userId o userIds requerido');
    return;
  }
  try {
    success(res, await offerService.assignOffer(req.params.id, userIds));
  } catch (err: any) {
    err.statusCode === 400 ? badRequest(res, err.message) : err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const revoke: RequestHandler = async (req, res) => {
  try {
    success(res, await offerService.revokeOffer(req.params.id, req.params.userId));
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};
