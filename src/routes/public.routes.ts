import { Router } from 'express';
import { publicController } from '../controllers/public.controller';
import { validateBody } from '../middlewares/validate.middleware';
import { publicStudentLeadSchema } from '../validators/public-lead.validator';
import { publicPartnerRegisterSchema } from '../validators/public-partner.validator';

const router = Router();

// Public routes for student QR scans and landing page
router.get('/partners/:partnerCode', publicController.verifyPartner);
router.get('/courses', publicController.getCourses);
router.post('/leads', validateBody(publicStudentLeadSchema), publicController.submitLead);
router.post('/partners/register', validateBody(publicPartnerRegisterSchema), publicController.registerPartner);

export default router;

