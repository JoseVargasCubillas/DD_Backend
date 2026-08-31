import { Router } from 'express';
import express from 'express';
import * as paymentController from '../../templates/controllers/payment.controller.js';
import { authenticate, optionalAuthenticate } from '../../molecules/middleware/auth.middleware.js';
import { globalLimiter } from '../../molecules/middleware/rateLimit.middleware.js';

const router = Router();
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.webhook);
router.post('/intent', optionalAuthenticate, paymentController.createIntent);
router.post('/shipping-quote', globalLimiter, paymentController.quoteShipping);
router.use(authenticate);
router.get('/orders', paymentController.getOrders);
export default router;
