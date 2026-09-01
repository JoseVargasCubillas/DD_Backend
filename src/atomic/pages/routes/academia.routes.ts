import { Router } from 'express';
import * as academiaController from '../../templates/controllers/academia.controller.js';
import { globalLimiter } from '../../molecules/middleware/rateLimit.middleware.js';

const router = Router();

// Publico: se abre desde el correo de confirmacion de compra, sin sesion iniciada.
router.get('/whatsapp/:token', globalLimiter, academiaController.joinWhatsappGroup);

export default router;
