import { Router } from 'express';
import * as whatsappController from '../../templates/controllers/whatsapp.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/segments', whatsappController.getSegments);
router.get('/contacts', whatsappController.getSegmentContacts);
router.post('/broadcast', whatsappController.sendBroadcast);

export default router;
