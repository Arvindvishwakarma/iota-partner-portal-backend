import { z } from 'zod';
import { NotificationChannel, NotificationStatus } from '../shared';

export const whatsappTemplateEnum = z.enum([
  'lead_welcome_student',
  'counsellor_assigned',
  'partner_commission_credited',
  'partner_settlement_disbursed',
  'general_announcement'
]);

export const sendNotificationSchema = z.object({
  userId: z.string().uuid().optional(),
  phone: z
    .string()
    .regex(/^(?:\+91|91)?[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian mobile number')
    .optional(),
  email: z.string().email('Please enter a valid email address').optional(),
  channel: z.nativeEnum(NotificationChannel),
  title: z.string().min(2, 'Title must be at least 2 characters').max(200),
  message: z.string().min(3, 'Message must be at least 3 characters').max(2000),
  actionUrl: z.string().optional().nullable(),
  templateId: whatsappTemplateEnum.optional(),
  templateParams: z.record(z.string()).optional(),
  metadata: z.record(z.any()).optional()
}).refine(
  (data) => {
    // If channel is IN_APP, userId is required
    if (data.channel === NotificationChannel.IN_APP && !data.userId) {
      return false;
    }
    // If channel is WHATSAPP, either phone or userId must be present
    if (data.channel === NotificationChannel.WHATSAPP && !data.phone && !data.userId) {
      return false;
    }
    // If channel is EMAIL, either email or userId must be present
    if (data.channel === NotificationChannel.EMAIL && !data.email && !data.userId) {
      return false;
    }
    return true;
  },
  {
    message: 'Destination identifier (userId, phone, or email) is required for the chosen communication channel',
    path: ['channel']
  }
);

export const queryNotificationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  channel: z.nativeEnum(NotificationChannel).optional(),
  status: z.nativeEnum(NotificationStatus).optional(),
  unreadOnly: z.coerce.boolean().optional()
});

export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
export type QueryNotificationsInput = z.infer<typeof queryNotificationsSchema>;

