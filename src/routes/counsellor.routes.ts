import { Router } from 'express';
import { counsellorController } from '../controllers/counsellor.controller';
import { authenticateJwt, requireRole } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { Role } from '../shared';
import {
  convertAdmissionSchema,
  logActivitySchema,
  updateLeadStatusSchema
} from '../validators/counsellor.validator';

const router = Router();

// Guard all counselor routes: accessible only by COUNSELLOR and ADMIN
router.use(authenticateJwt, requireRole([Role.COUNSELLOR, Role.ADMIN]));

// Pipeline overview dashboard
router.get('/dashboard', (req, res, next) => counsellorController.getDashboard(req, res, next));

// Available courses for intake
router.get('/courses', (req, res, next) => counsellorController.getCourses(req, res, next));

// Scheduled follow-ups console
router.get('/followups', (req, res, next) => counsellorController.getFollowups(req, res, next));

// Assigned leads list
router.get('/leads', (req, res, next) => counsellorController.getLeads(req, res, next));

// Lead profile detail
router.get('/leads/:id', (req, res, next) => counsellorController.getLeadById(req, res, next));

// Log interaction/activity (call, note, etc.)
router.post('/leads/:id/activities', validateBody(logActivitySchema), (req, res, next) =>
  counsellorController.logActivity(req, res, next)
);

// Advance pipeline stage with state machine validation
router.patch('/leads/:id/status', validateBody(updateLeadStatusSchema), (req, res, next) =>
  counsellorController.updateLeadStatus(req, res, next)
);

// Convert lead to confirmed admission
router.post('/leads/:id/convert-admission', validateBody(convertAdmissionSchema), (req, res, next) =>
  counsellorController.convertAdmission(req, res, next)
);

export default router;
