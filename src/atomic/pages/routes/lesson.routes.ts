import { Router } from 'express';
import * as lessonController from '../../templates/controllers/lesson.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router({ mergeParams: true });
router.get('/', lessonController.listByCourse);
router.get('/:id', authenticate, lessonController.getOne);
router.use(authenticate, requireAdmin);
router.post('/', lessonController.create);
router.put('/:id', lessonController.update);
router.delete('/:id', lessonController.remove);
export default router;
