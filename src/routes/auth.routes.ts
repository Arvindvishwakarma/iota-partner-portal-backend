import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticateJwt } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { loginSchema, changePasswordSchema } from '../validators/auth.validator';

const router = Router();

// Public Auth Endpoints
router.post('/login', validateBody(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

// Protected Auth Endpoints
router.get('/me', authenticateJwt, authController.me);
router.patch('/change-password', authenticateJwt, validateBody(changePasswordSchema), authController.changePassword);

export default router;

