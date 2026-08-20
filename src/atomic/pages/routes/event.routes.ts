import { Router } from 'express';
import * as eventController from '../../templates/controllers/event.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.get('/', eventController.list);
router.get('/:slug', eventController.getBySlug);
router.use(authenticate);
router.post('/:id/register', eventController.register);
router.post('/', requireAdmin, eventController.create);
router.put('/:id', requireAdmin, eventController.update);
router.post('/:id/assign', requireAdmin, eventController.adminAssign);
router.post('/:id/deregister', requireAdmin, eventController.adminDeregister);
export default router;
