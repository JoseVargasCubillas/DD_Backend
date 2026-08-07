import { Router } from 'express';
import * as emailController from '../../templates/controllers/email.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/segments', emailController.getSegments);
router.get('/contacts', emailController.getSegmentContacts);
router.post('/broadcast', emailController.sendBroadcast);

export default router;
