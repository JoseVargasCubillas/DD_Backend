import { RequestHandler } from 'express';
import * as paymentService from '../../organisms/services/payment.service.js';
import { stripe } from '../../../config/stripe.js';
import { env } from '../../../config/env.js';
import { success, badRequest, serverError } from '../../atoms/helpers/response.helper.js';

export const createIntent: RequestHandler = async (req, res) => {
  try {
    const userId = (req as any).user?._id ? String((req as any).user._id) : undefined;
    const result = await paymentService.createPaymentIntent(userId, req.body.items, req.body.shipping, req.body.customer);
    success(res, result);
  } catch (err: any) {
    err.statusCode === 400 ? badRequest(res, err.message) : serverError(res, err);
  }
};

export const webhook: RequestHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event;

  try {
    event = stripe.webhooks.constructEvent((req as any).rawBody, sig, env.stripe.webhookSecret);
  } catch (err: any) {
    badRequest(res, `Webhook error: ${err.message}`);
    return;
  }

  try {
    await paymentService.handleWebhook(event);
  } catch (err: any) {
    console.error(`Stripe webhook handler failed for ${event.type}:`, err.message);
  }

  res.json({ received: true });
};

export const getOrders: RequestHandler = async (req, res) => {
  try {
    const user = (req as any).user;
    const orders = user?.role === 'admin'
      ? await paymentService.getAllOrders()
      : await paymentService.getOrdersByUser(String(user._id));
    success(res, orders);
  } catch (err: any) { serverError(res, err); }
};
