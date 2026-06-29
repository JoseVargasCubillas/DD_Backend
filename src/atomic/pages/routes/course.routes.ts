import { Router } from 'express';
import * as courseController from '../../templates/controllers/course.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';
import { createCourseValidator } from '../../atoms/validators/course.validator.js';

const router = Router();
router.get('/', courseController.list);
router.get('/admin/:id', authenticate, requireAdmin, courseController.getByIdAdmin);
router.get('/:slug', courseController.getBySlug);
router.use(authenticate);
router.post('/', requireAdmin, createCourseValidator, courseController.create);
router.put('/:id', requireAdmin, courseController.update);
router.delete('/:id', requireAdmin, courseController.remove);
export default router;
