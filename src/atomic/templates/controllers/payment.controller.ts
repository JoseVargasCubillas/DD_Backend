import { RequestHandler } from 'express';
import * as paymentService from '../../organisms/services/payment.service.js';
import { stripe } from '../../../config/stripe.js';
import { env } from '../../../config/env.js';
import { success, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

export const createIntent: RequestHandler = async (req, res) => {
  try {
    const result = await paymentService.createPaymentIntent(String((req as any).user._id), req.body.items);
    success(res, result);
  } catch (err: any) { serverError(res, err); }
};

export const webhook: RequestHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  try {
    const event = stripe.webhooks.constructEvent((req as any).rawBody, sig, env.stripe.webhookSecret);
    await paymentService.handleWebhook(event);
    res.json({ received: true });
  } catch (err: any) {
    badRequest(res, `Webhook error: ${err.message}`);
  }
};

export const getOrders: RequestHandler = async (req, res) => {
  try {
    const orders = await paymentService.getOrdersByUser(String((req as any).user._id));
    success(res, orders);
  } catch (err: any) { serverError(res, err); }
};
