import { Router } from 'express';
import * as subscriptionController from '../../templates/controllers/subscription.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';

const router = Router();
router.post('/', subscriptionController.subscribe);
router.get('/active', authenticate, subscriptionController.getActive);
router.post('/cancel', authenticate, subscriptionController.cancel);
export default router;
