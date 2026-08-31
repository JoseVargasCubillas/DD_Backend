import { Router } from 'express';
import * as receiptController from '../../templates/controllers/receipt.controller.js';
import { globalLimiter } from '../../molecules/middleware/rateLimit.middleware.js';

const router = Router();

// Publico: se abre desde el correo de confirmacion, sin sesion iniciada.
router.get('/subscription/:id', globalLimiter, receiptController.getSubscriptionReceipt);
router.get('/order/:id', globalLimiter, receiptController.getOrderReceipt);

export default router;
