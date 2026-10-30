import { Router } from 'express';
import { publicController } from '../controllers/public.controller';
import { validateBody } from '../middlewares/validate.middleware';
import { publicStudentLeadSchema } from '../validators/public-lead.validator';

const router = Router();

// Public routes for student QR scans and landing page
router.get('/partners/:partnerCode', publicController.verifyPartner);
router.get('/courses', publicController.getCourses);
router.post('/leads', validateBody(publicStudentLeadSchema), publicController.submitLead);

export default router;

