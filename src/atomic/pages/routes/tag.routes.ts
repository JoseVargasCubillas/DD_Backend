import { Router } from 'express';
import * as tagController from '../../templates/controllers/tag.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', tagController.list);
router.post('/', tagController.create);
router.put('/:id', tagController.update);
router.delete('/:id', tagController.remove);

export default router;
