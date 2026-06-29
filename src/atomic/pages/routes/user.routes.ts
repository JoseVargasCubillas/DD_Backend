import { Router } from 'express';
import * as userController from '../../templates/controllers/user.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.use(authenticate);

// ── Usuario actual ───────────────────────────────────────────
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);

// ── Admin: contactos / suscriptores ──────────────────────────
router.get('/', requireAdmin, userController.listUsers);
router.get('/:id', requireAdmin, userController.getUserById);
router.put('/:id', requireAdmin, userController.adminUpdateUser);
router.patch('/:id/toggle', requireAdmin, userController.toggleActive);
router.post('/:id/tags', requireAdmin, userController.assignTag);
router.delete('/:id/tags/:tagId', requireAdmin, userController.removeTag);
router.put('/:id/notes', requireAdmin, userController.updateNotes);
router.post('/:id/send-password', requireAdmin, userController.sendPasswordReset);

export default router;

