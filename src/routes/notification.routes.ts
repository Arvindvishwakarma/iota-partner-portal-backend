import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticateJwt, requireRole } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { Role } from '../shared';
import { sendNotificationSchema } from '../validators/notification.validator';

const router = Router();

// Authenticated user endpoints (accessible by all roles: ADMIN, COUNSELLOR, SALES, PARTNER)
router.use(authenticateJwt);

// User notification feed & unread count
router.get('/me', (req, res, next) => notificationController.getMyNotifications(req, res, next));
router.patch('/:id/read', (req, res, next) => notificationController.markAsRead(req, res, next));
router.patch('/read-all', (req, res, next) => notificationController.markAllAsRead(req, res, next));

// Admin-only communication hub dispatch & audit logs
router.post(
  '/send',
  requireRole([Role.ADMIN]),
  validateBody(sendNotificationSchema),
  (req, res, next) => notificationController.sendNotification(req, res, next)
);

router.get('/admin/logs', requireRole([Role.ADMIN]), (req, res, next) =>
  notificationController.getAdminNotificationLogs(req, res, next)
);

router.post('/admin/retry/:id', requireRole([Role.ADMIN]), (req, res, next) =>
  notificationController.retryNotification(req, res, next)
);

export default router;

