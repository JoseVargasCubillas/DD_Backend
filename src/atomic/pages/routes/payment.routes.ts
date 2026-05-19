import { Router } from 'express';
import express from 'express';
import * as paymentController from '../../templates/controllers/payment.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';

const router = Router();
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.webhook);
router.use(authenticate);
router.post('/intent', paymentController.createIntent);
router.get('/orders', paymentController.getOrders);
export default router;
