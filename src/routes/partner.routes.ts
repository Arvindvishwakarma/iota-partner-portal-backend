import { Router } from 'express';
import { partnerController } from '../controllers/partner.controller';
import { authenticateJwt, requireRole } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { Role } from '../shared';
import { createSupportTicketSchema } from '../validators/public-lead.validator';

const router = Router();

// Partner Role Guard
router.use(authenticateJwt, requireRole([Role.PARTNER]));

router.get('/dashboard', partnerController.getDashboard.bind(partnerController));
router.get('/assets/qr', partnerController.getQrAssets.bind(partnerController));
router.get('/leads', partnerController.getLeads.bind(partnerController));
router.get('/commissions', partnerController.getCommissions.bind(partnerController));
router.get('/settlements', partnerController.getSettlements.bind(partnerController));
router.post('/tickets', validateBody(createSupportTicketSchema), partnerController.createTicket.bind(partnerController));

export default router;

