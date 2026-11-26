import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticateJwt } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { createRateLimiter } from '../middlewares/rate-limit.middleware';
import {
  loginSchema,
  changePasswordSchema,
  forgotPasswordEmailSendSchema,
  forgotPasswordEmailVerifySchema,
  forgotPasswordEmailResetSchema,
  forgotPasswordWaSendSchema,
  forgotPasswordWaVerifySchema,
  forgotPasswordWaResetSchema
} from '../validators/auth.validator';

const router = Router();

const forgotSendRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many password reset code requests. Please try again after 15 minutes.',
  keyGenerator: (req) => String(req.body?.email || req.body?.mobile || '').toLowerCase()
});

const forgotVerifyRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many verification attempts. Please try again later.',
  keyGenerator: (req) => String(req.body?.email || req.body?.mobile || '').toLowerCase()
});

// Public Auth Endpoints
router.post('/login', validateBody(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

// Public Forgot Password Flow (Email Verification Code + WhatsApp OTP)
router.post(
  '/forgot-password/email/send-code',
  forgotSendRateLimiter,
  validateBody(forgotPasswordEmailSendSchema),
  authController.forgotPasswordSendEmailCode
);
router.post(
  '/forgot-password/email/verify-code',
  forgotVerifyRateLimiter,
  validateBody(forgotPasswordEmailVerifySchema),
  authController.forgotPasswordVerifyEmailCode
);
router.post(
  '/forgot-password/email/reset',
  validateBody(forgotPasswordEmailResetSchema),
  authController.forgotPasswordResetByEmail
);

router.post(
  '/forgot-password/whatsapp/send-otp',
  forgotSendRateLimiter,
  validateBody(forgotPasswordWaSendSchema),
  authController.forgotPasswordSendWhatsappOtp
);
router.post(
  '/forgot-password/whatsapp/verify-otp',
  forgotVerifyRateLimiter,
  validateBody(forgotPasswordWaVerifySchema),
  authController.forgotPasswordVerifyWhatsappOtp
);
router.post(
  '/forgot-password/whatsapp/reset',
  validateBody(forgotPasswordWaResetSchema),
  authController.forgotPasswordResetByWhatsapp
);

// Protected Auth Endpoints
router.get('/me', authenticateJwt, authController.me);
router.patch('/change-password', authenticateJwt, validateBody(changePasswordSchema), authController.changePassword);

export default router;

