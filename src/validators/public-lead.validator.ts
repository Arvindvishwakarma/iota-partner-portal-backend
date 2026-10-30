import { z } from 'zod';
import { INDIAN_PHONE_REGEX } from '../shared';

/**
 * Helper to normalize Indian phone number into canonical E.164 (+91XXXXXXXXXX)
 */
export function normalizeIndianPhone(input: string): string {
  // Strip spaces, dashes, parentheses
  const cleaned = input.replace(/[\s\-\(\)]/g, '');

  if (cleaned.startsWith('+91') && cleaned.length === 13) {
    return cleaned;
  }
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    return `+91${cleaned.substring(1)}`;
  }
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }

  return cleaned;
}

export const publicStudentLeadSchema = z.object({
  partnerCode: z.string({ required_error: 'Partner code is required' }).trim().toUpperCase(),
  studentName: z.string({ required_error: 'Full name is required' }).min(2, 'Name must be at least 2 characters').trim(),
  mobile: z
    .string({ required_error: 'Mobile number is required' })
    .transform(normalizeIndianPhone)
    .refine((val) => INDIAN_PHONE_REGEX.test(val), {
      message: 'Please enter a valid 10-digit Indian mobile number (e.g., 9876543210 or +919876543210)'
    }),
  whatsapp: z
    .string()
    .optional()
    .transform((val) => (val ? normalizeIndianPhone(val) : undefined))
    .refine((val) => !val || INDIAN_PHONE_REGEX.test(val), {
      message: 'Invalid WhatsApp number format'
    }),
  interestedCourseId: z.string().optional(),
  currentEducation: z.string().min(2, 'Current educational background is required').trim(),
  city: z.string().min(2, 'City is required').trim(),
  area: z.string().optional(),
  preferredContactTime: z.enum(['MORNING_10AM_1PM', 'AFTERNOON_1PM_4PM', 'EVENING_4PM_7PM', 'ANYTIME']).default('ANYTIME'),
  communicationConsent: z.boolean({ required_error: 'Communication consent is required' }).refine((val) => val === true, {
    message: 'You must consent to be contacted by IOTA Academy academic counselors'
  })
});

export const createSupportTicketSchema = z.object({
  subject: z.string().min(3, 'Subject must be at least 3 characters').trim(),
  description: z.string().min(10, 'Description must be at least 10 characters').trim(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM')
});

