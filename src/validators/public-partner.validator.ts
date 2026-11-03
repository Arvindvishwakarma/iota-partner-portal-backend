import { z } from 'zod';
import { normalizeIndianPhone } from './public-lead.validator';
import { INDIAN_PHONE_REGEX, PartnerCategory } from '../shared';

/**
 * Maps human-readable category strings (from landing page) or raw enum values to PartnerCategory enum
 */
export function mapCategoryToEnum(cat?: string | null): PartnerCategory {
  if (!cat) return PartnerCategory.OTHER;
  const lower = cat.toLowerCase();
  if (lower.includes('book') || lower.includes('stationery') || lower.includes('cafe')) {
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
  if (lower.includes('education') || lower.includes('school') || lower.includes('college')) {
    return PartnerCategory.EDUCATIONAL_INSTITUTE;
  }
  return PartnerCategory.OTHER;
}

export const publicPartnerRegisterSchema = z.object({
  fullName: z
    .string({ required_error: 'Full name is required' })
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name must be under 100 characters')
    .trim(),
  phone: z
    .string({ required_error: 'WhatsApp / Mobile number is required' })
    .transform(normalizeIndianPhone)
    .refine((val) => INDIAN_PHONE_REGEX.test(val), {
      message: 'Please enter a valid 10-digit Indian mobile number (e.g., 9876543210 or +919876543210)'
    }),
  email: z
    .string({ required_error: 'Email address is required' })
    .email('Please enter a valid email address')
    .toLowerCase()
    .trim(),
  category: z.string().optional().default('Other Business Owner'),
  businessName: z.string().max(150).optional().nullable(),
  address: z
    .string({ required_error: 'Full address is required' })
    .min(5, 'Full address must be at least 5 characters')
    .max(300, 'Address must be under 300 characters')
    .trim(),
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

