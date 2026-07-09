import { RequestHandler } from 'express';
import * as subscriptionService from '../../organisms/services/subscription.service.js';
import { badRequest, success, notFound, serverError } from '../../atoms/helpers/response.helper.js';

type SubscribeBody = {
  priceId?: string;
  plan?: string;
  item?: {
    type?: string;
    refId?: string;
    quantity?: number;
  };
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
};

export const subscribe: RequestHandler = async (req, res) => {
  try {
    const body = req.body as SubscribeBody;
    const userId = (req as any).user?._id ? String((req as any).user._id) : undefined;
    const result = await subscriptionService.createSubscription({
      userId,
      priceId: body.priceId,
      plan: body.plan,
      item: body.item,
      customer: body.customer,
    });
    success(res, result);
  } catch (err: any) {
    err.statusCode === 400 ? badRequest(res, err.message) : serverError(res, err);
  }
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