import { Router } from 'express';
import * as packageController from '../../templates/controllers/package.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', packageController.list);
router.post('/', packageController.create);
router.get('/:id', packageController.get);
router.put('/:id', packageController.update);
router.delete('/:id', packageController.remove);

// asignar paquete a usuario
router.post('/assign/:userId', packageController.assignToUser);

export default router;
