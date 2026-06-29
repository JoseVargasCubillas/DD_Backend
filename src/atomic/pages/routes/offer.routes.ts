import { Router } from 'express';
import * as offerController from '../../templates/controllers/offer.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.use(authenticate, requireAdmin);
router.get('/', offerController.list);
router.post('/', offerController.create);
router.get('/:id', offerController.get);
router.put('/:id', offerController.update);
router.delete('/:id', offerController.remove);
router.post('/:id/assign', offerController.assign);
router.delete('/:id/users/:userId', offerController.revoke);

export default router;
