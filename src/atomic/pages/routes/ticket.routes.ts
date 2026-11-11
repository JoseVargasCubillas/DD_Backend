import { Router } from 'express';
import * as ticketController from '../../templates/controllers/ticket.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin, requireStaff } from '../../molecules/middleware/role.middleware.js';
import { globalLimiter } from '../../molecules/middleware/rateLimit.middleware.js';

const router = Router();

// Escáner de entrada: admin y staff. Deshacer un check-in sigue siendo solo admin.
router.post('/check-in', authenticate, requireStaff, ticketController.checkIn);
router.get('/check-in/events', authenticate, requireStaff, ticketController.listCheckInEvents);
router.post('/:folio/undo-check-in', authenticate, requireAdmin, ticketController.undoCheckIn);
// Herramientas de Asistentes (solo admin): baja reversible, reactivar y eliminar altas manuales.
router.post('/:folio/void', authenticate, requireAdmin, ticketController.voidAttendee);
router.post('/:folio/reactivate', authenticate, requireAdmin, ticketController.reactivateAttendee);
router.delete('/:folio', authenticate, requireAdmin, ticketController.deleteAttendee);

// Público: el QR del correo abre /boleto/:folio?t= en el frontend, que
// consulta estos endpoints con la firma.
router.get('/:folio/qr.png', globalLimiter, ticketController.getTicketQr);
router.get('/:folio', globalLimiter, ticketController.getTicket);

export default router;
