import { Router } from 'express';
import { publicController } from '../controllers/public.controller';
import { validateBody } from '../middlewares/validate.middleware';
import { publicStudentLeadSchema } from '../validators/public-lead.validator';
import { publicPartnerRegisterSchema } from '../validators/public-partner.validator';
import { contactMessageSchema } from '../validators/contact.validator';

const router = Router();

// Public routes for student QR scans, contact, and landing page
router.get('/partners/:partnerCode', publicController.verifyPartner);
router.get('/courses', publicController.getCourses);
router.post('/leads', validateBody(publicStudentLeadSchema), publicController.submitLead);
router.post('/partners/register', validateBody(publicPartnerRegisterSchema), publicController.registerPartner);
router.post('/contact', validateBody(contactMessageSchema), publicController.submitContactMessage);

export default router;

