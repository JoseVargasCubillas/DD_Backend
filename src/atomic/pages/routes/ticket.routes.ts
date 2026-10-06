import { Router } from 'express';
import * as ticketController from '../../templates/controllers/ticket.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';
import { globalLimiter } from '../../molecules/middleware/rateLimit.middleware.js';

const router = Router();

// Admin: escáner de entrada.
router.post('/check-in', authenticate, requireAdmin, ticketController.checkIn);
router.post('/:folio/undo-check-in', authenticate, requireAdmin, ticketController.undoCheckIn);

// Público: el QR del correo abre /boleto/:folio?t= en el frontend, que
// consulta estos endpoints con la firma.
router.get('/:folio/qr.png', globalLimiter, ticketController.getTicketQr);
router.get('/:folio', globalLimiter, ticketController.getTicket);

export default router;
