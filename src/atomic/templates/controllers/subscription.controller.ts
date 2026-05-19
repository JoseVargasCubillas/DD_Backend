import { RequestHandler } from 'express';
import * as subscriptionService from '../../organisms/services/subscription.service.js';
import { success, notFound, serverError } from '../../atoms/helpers/response.helper.js';

export const subscribe: RequestHandler = async (req, res) => {
  try {
    const { priceId, plan } = req.body as { priceId: string; plan: string };
    const result = await subscriptionService.createSubscription(String((req as any).user._id), priceId, plan);
    success(res, result);
  } catch (err: any) { serverError(res, err); }
};

export const cancel: RequestHandler = async (req, res) => {
  try {
    const sub = await subscriptionService.cancelSubscription(String((req as any).user._id));
    success(res, sub);
  } catch (err: any) {
    err.statusCode === 404 ? notFound(res, err.message) : serverError(res, err);
  }
};

export const getActive: RequestHandler = async (req, res) => {
  try {
    const sub = await subscriptionService.getActiveSubscription(String((req as any).user._id));
    success(res, sub);
  } catch (err: any) { serverError(res, err); }
};
