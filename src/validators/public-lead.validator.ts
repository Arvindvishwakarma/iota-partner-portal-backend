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

export function toCapitalCase(str?: string | null): string {
  if (!str) return '';
  return str
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export const publicStudentLeadSchema = z.object({
  partnerCode: z.string({ required_error: 'Partner code is required' }).trim().toUpperCase(),
  studentName: z
    .string({ required_error: 'Full name is required' })
    .min(2, 'Name must be at least 2 characters')
    .trim()
    .transform(toCapitalCase),
  mobile: z
    .string({ required_error: 'Mobile number is required' })
    .transform(normalizeIndianPhone)
    .refine((val) => INDIAN_PHONE_REGEX.test(val), {
      message: 'Please enter a valid 10-digit Indian mobile number (e.g., 8962545150 or +918962545150)'
    }),
  whatsapp: z
    .string({ required_error: 'WhatsApp number is required' })
    .transform((val) => normalizeIndianPhone(val))
    .refine((val) => INDIAN_PHONE_REGEX.test(val), {
      message: 'Please enter a valid 10-digit Indian WhatsApp number'
    }),
  whatsappVerificationToken: z
    .string({ required_error: 'WhatsApp OTP verification is required' })
    .trim()
    .min(10, 'WhatsApp OTP verification is required'),
  otpSessionId: z
    .string({ required_error: 'Enquiry verification session is required' })
    .trim()
    .min(8, 'Invalid verification session')
    .max(120),
  interestedCourseId: z.string({ required_error: 'Interested course is required' }).trim().min(1, 'Please select your interested course'),
  currentEducation: z.string().min(2, 'Highest education is required').trim(),
  city: z.string().min(2, 'City is required').trim().transform(toCapitalCase),
  preferredContactTime: z.enum(['MORNING_10AM_1PM', 'AFTERNOON_1PM_4PM', 'EVENING_4PM_7PM', 'ANYTIME']).default('ANYTIME'),
  preferredLearningMode: z.enum(['OFFLINE', 'ONLINE', 'HYBRID']).default('OFFLINE'),
  communicationConsent: z.boolean({ required_error: 'Communication consent is required' }).refine((val) => val === true, {
    message: 'You must agree to receive updates from IOTA Academy before submitting'
  }),
  consentVersion: z.string().trim().max(30).optional().default('v1.0')
});

export const createSupportTicketSchema = z.object({
  subject: z.string().min(3, 'Subject must be at least 3 characters').trim(),
  description: z.string().min(10, 'Description must be at least 10 characters').trim(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM')
});

