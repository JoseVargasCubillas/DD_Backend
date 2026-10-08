import { Router } from 'express';
import * as integrations from '../../templates/controllers/integrations.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();

// Todo es solo para administradores.
router.use(authenticate, requireAdmin);
router.get('/status', integrations.getStatus);
router.post('/event-catalog', integrations.syncEventCatalog);
router.post('/hubspot/sync', integrations.syncHubspotNow);

export default router;
