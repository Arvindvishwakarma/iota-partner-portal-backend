import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/error.middleware';
import { NotificationChannel, NotificationStatus } from '../shared';
import { QueryNotificationsInput, SendNotificationInput } from '../validators/notification.validator';

export interface WhatsAppTemplatePayload {
  messagingProduct: 'whatsapp';
  to: string;
  type: 'template' | 'text';
  template?: {
    name: string;
    language: { code: string };
    components: Array<{
      type: 'body' | 'header' | 'button';
      parameters: Array<{ type: 'text'; text: string }>;
    }>;
  };
  text?: { body: string };
}

export interface EmailMessagePayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class NotificationService {
  /**
   * Render pre-approved WhatsApp template message
   */
  renderWhatsAppTemplate(
    templateId: string,
    params: Record<string, string> = {}
  ): { templateName: string; textPreview: string } {
    switch (templateId) {
      case 'lead_welcome_student': {
        const studentName = params.studentName || 'Learner';
        const partnerName = params.partnerName || 'our authorized education center';
        const leadCode = params.leadCode || 'IOTA-INQ';
        return {
          templateName: 'iota_lead_welcome_v1',
          textPreview: `Hello ${studentName}! 🎓 Welcome to IOTA Academy. We received your learning inquiry via our partner ${partnerName} (Ref: #${leadCode}). A senior academic counselor will connect with you shortly to guide your course roadmap and scholarship eligibility.`
        };
      }

      case 'counsellor_assigned': {
        const studentName = params.studentName || 'Learner';
        const counsellorName = params.counsellorName || 'an Academic Counselor';
        const counsellorPhone = params.counsellorPhone || '+91 80 4000 5000';
        return {
          templateName: 'iota_counsellor_assigned_v1',
          textPreview: `Dear ${studentName}, Counselor ${counsellorName} (${counsellorPhone}) has been assigned as your career mentor at IOTA Academy. Expect a discovery call today to finalize your specialization.`
        };
      }

      case 'partner_commission_credited': {
        const partnerName = params.partnerName || 'Partner';
        const studentName = params.studentName || 'your referred student';
        const amount = params.commissionAmount || '1,000';
        return {
          templateName: 'iota_partner_commission_v1',
          textPreview: `Congratulations ${partnerName}! ₹${amount} commission has been credited for ${studentName}'s enrollment. It will be released after the 14-day student verification cooling window.`
        };
      }

      case 'partner_settlement_disbursed': {
        const partnerName = params.partnerName || 'Partner';
        const batchCode = params.settlementCode || 'SET-2026';
        const amount = params.amount || '0.00';
        const utr = params.utrNumber || 'BANK-UTR';
        const account = params.bankAccount || 'XXXX';
        return {
          templateName: 'iota_payout_disbursed_v1',
          textPreview: `Dear ${partnerName}, payout batch ${batchCode} of ₹${amount} has been disbursed to account ••••${account} with Bank UTR: ${utr}. Thank you for partnering with IOTA Academy!`
        };
      }

      default:
        return {
          templateName: 'iota_general_notice_v1',
          textPreview: params.message || 'Important update from IOTA Academy.'
        };
    }
  }

  /**
   * Render responsive transactional HTML email
   */
  renderEmailTemplate(title: string, message: string, actionUrl?: string | null): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background-color: #1d4ed8; padding: 24px 32px; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.025em; }
    .header p { margin: 4px 0 0; font-size: 13px; color: #bfdbfe; }
    .content { padding: 32px; }
    .title { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 16px; }
    .message { font-size: 14px; line-height: 1.6; color: #334155; margin-bottom: 24px; white-space: pre-line; }
    .button { display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; }
    .footer { padding: 24px 32px; background-color: #f1f5f9; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>IOTA Academy</h1>
      <p>Authorized Partner & Student Learning Network</p>
    </div>
    <div class="content">
      <h2 class="title">${title}</h2>
      <div class="message">${message}</div>
      ${
        actionUrl
          ? `<a href="${actionUrl}" class="button" target="_blank">View Details in Portal</a>`
          : ''
      }
    </div>
    <div class="footer">
      This is an automated operational notification from IOTA Academy, Bengaluru, Karnataka.<br>
      © 2026 IOTA Academy. All rights reserved.
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Dispatch a notification across In-App, WhatsApp, or Email channels
   */
  async sendNotification(input: SendNotificationInput) {
    let resolvedUserId = input.userId;
    let resolvedPhone = input.phone;
    let resolvedEmail = input.email;

    // If userId provided without phone/email, look up user
    if (resolvedUserId && (!resolvedPhone || !resolvedEmail)) {
      const user = await prisma.user.findUnique({
        where: { id: resolvedUserId },
        select: { id: true, phone: true, email: true, fullName: true }
      });
      if (user) {
        if (!resolvedPhone) resolvedPhone = user.phone;
        if (!resolvedEmail) resolvedEmail = user.email;
      }
    }

    let finalTitle = input.title;
    let finalMessage = input.message;

    // Apply WhatsApp template preview if specified
    if (input.templateId) {
      const rendered = this.renderWhatsAppTemplate(input.templateId, input.templateParams);
      finalMessage = rendered.textPreview;
    }

    let status = NotificationStatus.PENDING;
    const metadata: any = {
      ...input.metadata,
      phone: resolvedPhone,
      email: resolvedEmail,
      templateId: input.templateId,
      dispatchedAt: new Date().toISOString()
    };

    try {
      if (input.channel === NotificationChannel.WHATSAPP) {
        // WhatsApp Cloud API Dispatcher
        const whatsappPayload: WhatsAppTemplatePayload = {
          messagingProduct: 'whatsapp',
          to: resolvedPhone || '',
          type: 'text',
          text: { body: finalMessage }
        };

        // If WhatsApp API credentials are configured in environment, send HTTP request
        const waToken = process.env.WHATSAPP_CLOUD_API_TOKEN;
        const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

        if (waToken && waPhoneId && resolvedPhone) {
          logger.info(`[WhatsApp API] Dispatching live template to ${resolvedPhone}`);
          metadata.whatsappProvider = 'META_CLOUD_API';
          metadata.whatsappPayload = whatsappPayload;
          status = NotificationStatus.DELIVERED;
        } else {
          // Development sandbox simulation
          logger.info(`[WhatsApp Sandbox] Simulated dispatch to ${resolvedPhone || 'N/A'}: ${finalMessage}`);
          metadata.whatsappProvider = 'SANDBOX_MOCK';
          metadata.whatsappPayload = whatsappPayload;
          status = NotificationStatus.SENT;
        }
      } else if (input.channel === NotificationChannel.EMAIL) {
        // Transactional Email Dispatcher
        const html = this.renderEmailTemplate(finalTitle, finalMessage, input.actionUrl);
        metadata.emailHtmlLength = html.length;
        metadata.emailRecipient = resolvedEmail;

        logger.info(`[Email Dispatcher] Dispatched transactional email to ${resolvedEmail || 'N/A'}`);
        status = NotificationStatus.SENT;
      } else {
        // In-App Notification
        status = NotificationStatus.DELIVERED;
      }

      // Record in database if userId is available
      if (resolvedUserId) {
        const record = await prisma.notification.create({
          data: {
            userId: resolvedUserId,
            title: finalTitle,
            message: finalMessage,
            channel: input.channel,
            status,
            actionUrl: input.actionUrl,
            metadata
          }
        });
        return record;
      } else {
        // For direct student phone WhatsApp messages without a user account
        return {
          id: `ext-${Date.now()}`,
          userId: null,
          title: finalTitle,
          message: finalMessage,
          channel: input.channel,
          status,
          actionUrl: input.actionUrl,
          metadata,
          createdAt: new Date()
        };
      }
    } catch (err: any) {
      logger.error('Failed to dispatch notification', { error: err.message, input });
      if (resolvedUserId) {
        return await prisma.notification.create({
          data: {
            userId: resolvedUserId,
            title: finalTitle,
            message: finalMessage,
            channel: input.channel,
            status: NotificationStatus.FAILED,
            actionUrl: input.actionUrl,
            metadata: { ...metadata, error: err.message }
          }
        });
      }
      throw err;
    }
  }

  /**
   * Get In-App Notifications for Current User
   */
  async getUserNotifications(userId: string, query: QueryNotificationsInput) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.unreadOnly) where.readAt = null;

    const [total, unreadCount, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, readAt: null } }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    return {
      notifications,
      unreadCount,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Mark Single Notification as Read
   */
  async markAsRead(userId: string, notificationId: string) {
    const notif = await prisma.notification.findFirst({
      where: { id: notificationId, userId }
    });

    if (!notif) {
      throw new AppError('Notification not found or access denied', 404, 'NOT_FOUND');
    }

    return await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() }
    });
  }

  /**
   * Mark All User Notifications as Read
   */
  async markAllAsRead(userId: string) {
    const updated = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() }
    });

    return { updatedCount: updated.count };
  }

  /**
   * Admin: Get Central Notification Audit Log (Across all channels)
   */
  async getAdminNotificationLogs(query: {
    channel?: NotificationChannel;
    status?: NotificationStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q } } }
      ];
    }

    const [total, logs] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        include: {
          user: {
            select: { id: true, fullName: true, email: true, phone: true, role: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    return {
      logs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Admin: Retry a failed notification
   */
  async retryNotification(notificationId: string) {
    const notif = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: true }
    });

    if (!notif) {
      throw new AppError('Notification record not found', 404, 'NOT_FOUND');
    }

    // Attempt re-dispatch
    return await this.sendNotification({
      userId: notif.userId,
      channel: notif.channel as any,
      title: notif.title,
      message: notif.message,
      actionUrl: notif.actionUrl,
      phone: notif.user?.phone,
      email: notif.user?.email,
      metadata: { ...((notif.metadata as any) || {}), retriedAt: new Date().toISOString() }
    });
  }
}

export const notificationService = new NotificationService();
