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
router.post('/otp/send-whatsapp', publicController.sendWhatsAppOtp);
router.post('/otp/verify-whatsapp', publicController.verifyWhatsAppOtp);
router.get('/otp/whatsapp-status', publicController.getWhatsAppStatus);
router.post('/otp/send-email', publicController.sendEmailOtp);
router.post('/otp/verify-email', publicController.verifyEmailOtp);
router.post('/contact', validateBody(contactMessageSchema), publicController.submitContactMessage);

export default router;

