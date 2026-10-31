import { Router } from 'express';
import { salesController } from '../controllers/sales.controller';
import { authenticateJwt, requireRole } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { Role } from '../shared';
import {
  checkInSchema,
  checkOutSchema,
  onboardPartnerSchema,
  updateVisitStatusSchema
} from '../validators/sales.validator';

const router = Router();

// Guard all sales routes: accessible by SALES and ADMIN
router.use(authenticateJwt, requireRole([Role.SALES, Role.ADMIN]));

// Canvassing agenda dashboard
router.get('/dashboard', (req, res, next) => salesController.getDashboard(req, res, next));

// Assigned premises directory
router.get('/premises', (req, res, next) => salesController.getPremises(req, res, next));

// Direct premises/visit status update (No GPS check required)
router.post('/visits/:id/status', validateBody(updateVisitStatusSchema), (req, res, next) =>
  salesController.updateStatus(req, res, next)
);
router.patch('/visits/:id/status', validateBody(updateVisitStatusSchema), (req, res, next) =>
  salesController.updateStatus(req, res, next)
);
router.post('/premises/:id/status', validateBody(updateVisitStatusSchema), (req, res, next) =>
  salesController.updateStatus(req, res, next)
);

// GPS Check-In at premises (non-blocking)
router.post('/visits/:premisesId/check-in', validateBody(checkInSchema), (req, res, next) =>
  salesController.checkIn(req, res, next)
);

// Check-out & record field outcome
router.post('/visits/:visitId/check-out', validateBody(checkOutSchema), (req, res, next) =>
  salesController.checkOut(req, res, next)
);

// On-the-spot physical partner onboarding
router.post('/partners/onboard', validateBody(onboardPartnerSchema), (req, res, next) =>
  salesController.onboardPartner(req, res, next)
);

// Global leads monitor (with PII Masking)
router.get('/leads', (req, res, next) => salesController.getLeads(req, res, next));

export default router;

