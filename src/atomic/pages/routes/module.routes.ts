import { Router } from 'express';
import * as moduleController from '../../templates/controllers/module.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router({ mergeParams: true });
router.use(authenticate, requireAdmin);

// /api/v1/courses/:courseId/modules
router.get('/', moduleController.listByCourse);
router.post('/', moduleController.create);
router.post('/reorder', moduleController.reorder);

export const moduleItemRouter = Router();
moduleItemRouter.use(authenticate, requireAdmin);
moduleItemRouter.put('/:id', moduleController.update);
moduleItemRouter.delete('/:id', moduleController.remove);
moduleItemRouter.get('/:id/lessons', moduleController.lessonsByModule);
moduleItemRouter.post('/:id/lessons', moduleController.addLesson);

export default router;
