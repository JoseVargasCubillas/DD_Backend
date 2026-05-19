import { Router } from 'express';
import * as authController from '../../templates/controllers/auth.controller.js';
import { registerValidator, loginValidator } from '../../atoms/validators/auth.validator.js';
import { authLimiter } from '../../molecules/middleware/rateLimit.middleware.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';

const router = Router();
router.post('/register', authLimiter, registerValidator, authController.register);
router.post('/login', authLimiter, loginValidator, authController.login);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);
export default router;
