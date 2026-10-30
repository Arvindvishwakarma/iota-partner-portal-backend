import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { notificationService } from '../services/notification.service';
import { NotificationChannel, NotificationStatus } from '../shared';

export class NotificationController {
  async getMyNotifications(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const channel = req.query.channel as NotificationChannel | undefined;
      const unreadOnly = req.query.unreadOnly === 'true';

      const result = await notificationService.getUserNotifications(userId, {
        page,
        limit,
        channel,
        unreadOnly
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async markAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const notification = await notificationService.markAsRead(userId, id);

      res.status(200).json({
        success: true,
        data: notification,
        message: 'Notification marked as read.'
      });
    } catch (err) {
      next(err);
    }
  }

  async markAllAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const result = await notificationService.markAllAsRead(userId);

      res.status(200).json({
        success: true,
        data: result,
        message: `Marked ${result.updatedCount} notification(s) as read.`
      });
    } catch (err) {
      next(err);
    }
  }

  async sendNotification(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await notificationService.sendNotification(req.body);

      res.status(201).json({
        success: true,
        data: result,
        message: `Notification successfully dispatched via ${req.body.channel}.`
      });
    } catch (err) {
      next(err);
    }
  }

  async getAdminNotificationLogs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const channel = req.query.channel as NotificationChannel | undefined;
      const status = req.query.status as NotificationStatus | undefined;
      const search = req.query.search as string | undefined;

      const result = await notificationService.getAdminNotificationLogs({
        page,
        limit,
        channel,
        status,
        search
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async retryNotification(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await notificationService.retryNotification(id);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Notification re-dispatch queued successfully.'
      });
    } catch (err) {
      next(err);
    }
  }
}

export const notificationController = new NotificationController();
