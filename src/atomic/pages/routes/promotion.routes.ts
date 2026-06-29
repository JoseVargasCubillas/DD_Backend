import { Router } from 'express';
import * as promotionController from '../../templates/controllers/promotion.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();

// validar código (público autenticado)
router.get('/validate/:code', authenticate, promotionController.validate);

router.use(authenticate, requireAdmin);
router.get('/', promotionController.list);
router.post('/', promotionController.create);
router.put('/:id', promotionController.update);
router.delete('/:id', promotionController.remove);

export default router;
