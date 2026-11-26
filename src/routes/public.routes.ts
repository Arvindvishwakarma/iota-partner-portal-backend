import { Router } from 'express';
import { publicController } from '../controllers/public.controller';
import { validateBody } from '../middlewares/validate.middleware';
import { createRateLimiter } from '../middlewares/rate-limit.middleware';
import { publicStudentLeadSchema } from '../validators/public-lead.validator';
import { publicPartnerRegisterSchema } from '../validators/public-partner.validator';
import { contactMessageSchema } from '../validators/contact.validator';

const router = Router();

const otpSendLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 8,
  message: 'Too many OTP requests. Please wait a few minutes before requesting another OTP.'
});

const otpVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many OTP verification attempts. Please wait a few minutes and try again.'
});

const leadSubmitLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 15,
  message: 'Too many enquiry submissions from this connection. Please try again later.'
});

// Public routes for student QR scans, contact, and landing page
router.get('/partners/:partnerCode', publicController.verifyPartner);
router.get('/courses', publicController.getCourses);
router.post('/leads/check-duplicate', otpVerifyLimiter, publicController.checkDuplicateLeadPhone);
router.post('/leads', leadSubmitLimiter, validateBody(publicStudentLeadSchema), publicController.submitLead);
router.post('/partners/register', validateBody(publicPartnerRegisterSchema), publicController.registerPartner);
router.post('/otp/send-whatsapp', otpSendLimiter, publicController.sendWhatsAppOtp);
router.post('/otp/verify-whatsapp', otpVerifyLimiter, publicController.verifyWhatsAppOtp);
router.get('/otp/whatsapp-status', publicController.getWhatsAppStatus);
router.post('/otp/send-email', otpSendLimiter, publicController.sendEmailOtp);
router.post('/otp/verify-email', otpVerifyLimiter, publicController.verifyEmailOtp);
router.post('/contact', validateBody(contactMessageSchema), publicController.submitContactMessage);

export default router;

