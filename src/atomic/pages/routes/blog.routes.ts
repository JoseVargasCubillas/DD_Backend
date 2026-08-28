import { Router } from 'express';
import * as blogController from '../../templates/controllers/blog.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();

// Drafts (admin) — se registran ANTES del catch-all `/:slug` para evitar
// que el slug los sombree.
router.get('/drafts/list', authenticate, requireAdmin, blogController.listDrafts);
router.post('/drafts/generate', authenticate, requireAdmin, blogController.generateDrafts);
router.post('/drafts/:id/publish', authenticate, requireAdmin, blogController.publishDraft);

// Público
router.get('/', blogController.list);
router.get('/:slug', blogController.getBySlug);

// Admin CRUD
router.use(authenticate, requireAdmin);
router.post('/', blogController.create);
router.put('/:id', blogController.update);
router.delete('/:id', blogController.remove);

export default router;
