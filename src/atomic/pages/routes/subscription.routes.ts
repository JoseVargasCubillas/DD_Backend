import { Router } from 'express';
import * as subscriptionController from '../../templates/controllers/subscription.controller.js';
import { authenticate, optionalAuthenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.post('/', optionalAuthenticate, subscriptionController.subscribe);
router.get('/admin/all', authenticate, requireAdmin, subscriptionController.listAll);
router.get('/active', authenticate, subscriptionController.getActive);
router.post('/cancel', authenticate, subscriptionController.cancel);
export default router;
