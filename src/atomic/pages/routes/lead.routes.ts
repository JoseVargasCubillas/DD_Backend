import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as leadController from '../../templates/controllers/lead.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const guideLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas solicitudes, intenta más tarde.' },
});

const router = Router();

router.post('/sat-guide', guideLimiter, leadController.requestSatGuide);
router.post('/media-kit', guideLimiter, leadController.requestMediaKit);
router.post('/estrategia-fiscal-dossier', guideLimiter, leadController.requestEstrategiaFiscalDossier);
router.post('/resource', guideLimiter, leadController.requestDownloadableResource);
router.post('/newsletter', guideLimiter, leadController.subscribeNewsletter);
router.post('/sat-waitlist', guideLimiter, leadController.subscribeSatWaitlist);
router.get('/', authenticate, requireAdmin, leadController.list);
router.post('/bulk-delete', authenticate, requireAdmin, leadController.bulkRemove);
router.delete('/:id', authenticate, requireAdmin, leadController.remove);

export default router;
