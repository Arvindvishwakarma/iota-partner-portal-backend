import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { authenticateJwt, requireRole } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { Role } from '../shared';
import {
  createStaffSchema,
  updateStaffStatusSchema,
  updateStaffSchema,
  resetStaffPasswordSchema,
  partnerApprovalSchema,
  createPremisesSchema,
  updatePremisesSchema,
  assignVisitSchema,
  unassignVisitSchema,
  bulkAssignVisitsSchema,
  reassignLeadSchema
} from '../validators/admin.validator';
import { onboardPartnerSchema } from '../validators/sales.validator';

const router = Router();

// Apply Admin Role Guard to ALL admin routes
router.use(authenticateJwt, requireRole([Role.ADMIN]));

// Dashboard Metrics
router.get('/dashboard', adminController.getDashboard);

// Staff Management (Counselors & Sales)
router.get('/staff', adminController.listStaff);
router.post('/staff', validateBody(createStaffSchema), adminController.createStaff);
router.patch('/staff/:id/status', validateBody(updateStaffStatusSchema), adminController.updateStaffStatus);
router.patch('/staff/:id/password', validateBody(resetStaffPasswordSchema), adminController.resetStaffPassword);
router.post('/staff/:id/password', validateBody(resetStaffPasswordSchema), adminController.resetStaffPassword);
router.patch('/staff/:id', validateBody(updateStaffSchema), adminController.updateStaff);
router.put('/staff/:id', validateBody(updateStaffSchema), adminController.updateStaff);

// Partner Management & KYC Review
router.get('/partners', adminController.listPartners);
router.post('/partners/onboard', validateBody(onboardPartnerSchema), (req, res, next) =>
  adminController.onboardPartner(req, res, next)
);
router.get('/partners/:id', adminController.getPartner);
router.patch('/partners/:id/review', validateBody(partnerApprovalSchema), adminController.reviewPartner);
router.patch('/partners/:id/password', validateBody(resetStaffPasswordSchema), adminController.resetPartnerPassword);
router.post('/partners/:id/password', validateBody(resetStaffPasswordSchema), adminController.resetPartnerPassword);

// Premises Master Directory & Field Visits
router.get('/premises', adminController.listPremises);
router.post('/premises', validateBody(createPremisesSchema), adminController.createPremises);
router.patch('/premises/:id', validateBody(updatePremisesSchema), adminController.updatePremises);
router.put('/premises/:id', validateBody(updatePremisesSchema), adminController.updatePremises);
router.get('/visits', adminController.listVisits);
router.post('/visits/assign', validateBody(assignVisitSchema), adminController.assignVisit);
router.post('/visits/unassign', validateBody(unassignVisitSchema), adminController.unassignVisit);
router.post('/visits/bulk-assign', validateBody(bulkAssignVisitsSchema), adminController.bulkAssignVisits);

// Lead Monitoring & Reassignment
router.get('/leads', adminController.listLeads);
router.patch('/leads/:id/reassign', validateBody(reassignLeadSchema), adminController.reassignLead);

export default router;

