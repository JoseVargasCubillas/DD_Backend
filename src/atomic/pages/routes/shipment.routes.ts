import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as shipmentController from '../../templates/controllers/shipment.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();

// ── Público: el asesor entra con su link secreto (sin login) ─
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { success: false, message: 'Demasiadas solicitudes, intenta más tarde.' },
});
const validateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'Demasiadas validaciones, intenta más tarde.' },
});
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: { success: false, message: 'Demasiados envíos capturados, intenta más tarde.' },
});

router.get('/public/:token', publicLimiter, shipmentController.publicInfo);
router.get('/public/:token/mine', publicLimiter, shipmentController.publicMine);
router.get('/public/:token/postal-code/:postalCode', publicLimiter, shipmentController.publicPostalCode);
router.post('/public/:token/validate', validateLimiter, shipmentController.publicValidate);
router.post('/public/:token', submitLimiter, shipmentController.publicSubmit);

// ── Admin ────────────────────────────────────────────────────
router.use(authenticate, requireAdmin);

router.get('/advisors', shipmentController.listAdvisors);
router.post('/advisors', shipmentController.createAdvisor);
router.patch('/advisors/:id', shipmentController.updateAdvisor);
router.post('/advisors/:id/rotate', shipmentController.rotateAdvisorToken);

router.get('/', shipmentController.listShipments);
router.post('/refresh-tracking', shipmentController.refreshAllTracking);
router.get('/:id', shipmentController.getShipment);
router.get('/:id/quotes', shipmentController.getQuotes);
router.patch('/:id', shipmentController.editShipment);
router.post('/:id/approve', shipmentController.approveShipment);
router.post('/:id/reject', shipmentController.rejectShipment);
router.post('/:id/refresh-tracking', shipmentController.refreshTracking);

export default router;
