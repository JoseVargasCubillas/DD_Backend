import { Router } from 'express';
import * as blogController from '../../templates/controllers/blog.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.get('/', blogController.list);
router.get('/:slug', blogController.getBySlug);
router.use(authenticate, requireAdmin);
router.post('/', blogController.create);
router.put('/:id', blogController.update);
router.delete('/:id', blogController.remove);
export default router;
