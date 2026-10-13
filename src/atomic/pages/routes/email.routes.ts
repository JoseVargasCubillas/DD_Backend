import { Router } from 'express';
import * as emailController from '../../templates/controllers/email.controller.js';
import { authenticate } from '../../molecules/middleware/auth.middleware.js';
import { requireAdmin } from '../../molecules/middleware/role.middleware.js';

const router = Router();

// Webhook de Mailchimp (bajas): sin JWT, protegido con secreto en la URL.
router.get('/webhooks/mailchimp', emailController.mailchimpWebhook);
router.post('/webhooks/mailchimp', emailController.mailchimpWebhook);

router.use(authenticate, requireAdmin);

router.get('/segments', emailController.getSegments);
router.get('/contacts', emailController.getSegmentContacts);
router.post('/broadcast', emailController.sendBroadcast);
router.post('/test', emailController.sendTestCampaign);
router.get('/audiences', emailController.getAudiences);
router.get('/audiences/:audienceId/segments', emailController.getAudienceSegments);
router.get('/audiences/:audienceId/members', emailController.getAudienceMembers);
router.get('/campaigns', emailController.getCampaigns);
// "history" va antes que ":id" para que no se interprete como un id.
router.get('/campaigns/history', emailController.getCampaignHistory);
router.get('/campaigns/:id', emailController.getCampaignById);
router.get('/queue-status', emailController.getMigrationQueueStatus);

export default router;
