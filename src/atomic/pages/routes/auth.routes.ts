import { Router } from 'express';
import * as authController from '../../templates/controllers/auth.controller.js';
import {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
} from '../../atoms/validators/auth.validator.js';
import { authLimiter } from '../../molecules/middleware/rateLimit.middleware.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.post('/register', authLimiter, registerValidator, authController.register);
router.post('/login', authLimiter, loginValidator, authController.login);
router.post('/refresh', authController.refresh);
router.post('/forgot-password', authLimiter, forgotPasswordValidator, authController.forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordValidator, authController.resetPassword);
router.post('/change-password', authenticate, changePasswordValidator, authController.changePassword);
router.get('/me', authenticate, authController.me);

// Admin crea cuenta y envía credenciales por correo
router.post('/admin/users', authenticate, requireAdmin, authController.adminCreateUser);

export default router;

