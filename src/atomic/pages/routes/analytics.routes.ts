import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as waClickController from '../../templates/controllers/wa-click.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

// Un botón de WhatsApp humano no dispara más de un click por segundo.
// 300 clicks/min/IP tolera pruebas del admin y bots normales.
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiados clicks, intenta más tarde.' },
});

const router = Router();

router.post('/wa-click', trackLimiter, waClickController.track);
router.get('/wa-click/stats', authenticate, requireAdmin, waClickController.stats);
router.get('/wa-click', authenticate, requireAdmin, waClickController.list);

export default router;
