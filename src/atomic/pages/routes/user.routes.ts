import { Router } from 'express';
import * as userController from '../../templates/controllers/user.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.use(authenticate);
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.get('/', requireAdmin, userController.listUsers);
router.patch('/:id/toggle', requireAdmin, userController.toggleActive);
export default router;
