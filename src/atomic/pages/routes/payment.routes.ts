import { Router } from 'express';
import express from 'express';
import * as paymentController from '../../templates/controllers/payment.controller.js';
import { authenticate, optionalAuthenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';
import { adminOrReadApiKey } from '../../molecules/middleware/apiKey.middleware.js';
import { globalLimiter } from '../../molecules/middleware/rateLimit.middleware.js';

const router = Router();
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.webhook);
router.post('/intent', optionalAuthenticate, paymentController.createIntent);
router.post('/quote', globalLimiter, paymentController.quoteOrder);
router.post('/confirm', globalLimiter, paymentController.confirmIntent);
router.post('/shipping-quote', globalLimiter, paymentController.quoteShipping);
router.post('/validate-address', globalLimiter, paymentController.validateAddress);
router.get('/postal-code/:postalCode', globalLimiter, paymentController.postalCodeLookup);
// Lectura de todas las transacciones: admin con sesión o clave API de solo lectura
// (header X-API-Key) para el workflow de n8n. Va antes de authenticate a propósito.
router.get('/admin/orders', adminOrReadApiKey, paymentController.listAllOrders);
router.use(authenticate);
router.delete('/admin/orders/:id', requireAdmin, paymentController.deleteOrder);
router.get('/orders', paymentController.getOrders);
export default router;
