import { Router } from 'express';
import * as bookController from '../../templates/controllers/book.controller.js';

const router = Router();

router.get('/', bookController.list);
router.get('/:slug', bookController.getBySlug);

export default router;
