import { Router } from 'express';
import * as subscriptionController from '../../templates/controllers/subscription.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';

const router = Router();
router.use(authenticate);
router.get('/active', subscriptionController.getActive);
router.post('/', subscriptionController.subscribe);
router.post('/cancel', subscriptionController.cancel);
export default router;
