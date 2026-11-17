import { z } from 'zod';
import { normalizeIndianPhone } from './public-lead.validator';
import { INDIAN_PHONE_REGEX, PartnerCategory } from '../shared';

/**
 * Maps human-readable category strings (from landing page) or raw enum values to PartnerCategory enum
 */
export function mapCategoryToEnum(cat?: string | null): PartnerCategory {
  if (!cat) return PartnerCategory.OTHER;
  const lower = cat.toLowerCase();
  if (lower.includes('influencer') || lower.includes('creator')) {
    return PartnerCategory.OTHER;
  }
  if (lower.includes('stationery') || lower.includes('book') || lower.includes('cafe')) {
    return PartnerCategory.BOOKSTORE_OR_CAFE;
  }
  if (lower.includes('library')) {
    return PartnerCategory.LIBRARY;
  }
  if (lower.includes('hostel') || lower.includes('pg')) {
    return PartnerCategory.HOSTEL;
  }
  if (lower.includes('computer')) {
    return PartnerCategory.COMPUTER_CENTER;
  }
  if (lower.includes('coaching') || lower.includes('tuition')) {
    return PartnerCategory.COACHING_INSTITUTE;
  }
  if (lower.includes('tutor') || lower.includes('education') || lower.includes('school') || lower.includes('college')) {
    return PartnerCategory.EDUCATIONAL_INSTITUTE;
  }
  return PartnerCategory.OTHER;
}

export const publicPartnerRegisterSchema = z.object({
  firstName: z.string().max(60).optional().nullable(),
  lastName: z.string().max(60).optional().nullable(),
  fullName: z.string().max(120).optional().nullable(),
  phone: z
    .string({ required_error: 'Phone number is required' })
    .transform(normalizeIndianPhone)
    .refine((val) => INDIAN_PHONE_REGEX.test(val), {
      message: 'Please enter a valid 10-digit Indian mobile number (e.g., 9876543210 or +919876543210)'
    }),
  whatsapp: z
    .string()
    .transform(normalizeIndianPhone)
    .refine((val) => !val || INDIAN_PHONE_REGEX.test(val), {
      message: 'Please enter a valid 10-digit WhatsApp number'
    })
    .optional()
    .nullable(),
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address')
    .optional()
    .or(z.literal(''))
    .nullable(),
  category: z.string().optional().nullable(),
  occupation: z.string().max(100).optional().nullable(),
  gender: z.string().max(30).optional().nullable(),
  age: z.coerce.number().min(18, 'You must be at least 18 years old to apply').max(100).optional().nullable(),
  socialLink: z.string().max(300).optional().nullable(),
  otherBusiness: z.string().max(150).optional().nullable(),
  businessName: z.string().max(150).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  state: z
    .string({ required_error: 'State is required' })
    .min(2, 'State is required')
    .trim(),
  pincode: z
    .string({ required_error: 'Pincode is required' })
    .regex(/^\d{6}$/, 'Please enter a valid 6-digit PIN code')
    .trim(),
  notes: z.string().max(500).optional().nullable()
});

export type PublicPartnerRegisterInput = z.infer<typeof publicPartnerRegisterSchema>;
