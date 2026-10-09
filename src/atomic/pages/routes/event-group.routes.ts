import { Router } from 'express';
import * as eventGroupController from '../../templates/controllers/event-group.controller.js';
import { globalLimiter } from '../../molecules/middleware/rateLimit.middleware.js';

const router = Router();

// Público: enlace de un solo uso al grupo de WhatsApp de un evento online.
router.get('/:token', globalLimiter, eventGroupController.joinEventGroup);

export default router;
