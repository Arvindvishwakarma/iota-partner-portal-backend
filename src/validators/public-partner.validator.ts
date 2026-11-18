import { z } from 'zod';
import { normalizeIndianPhone } from './public-lead.validator';
import { INDIAN_PHONE_REGEX, PartnerCategory } from '../shared';

/**
 * Single source of truth for whether an occupation/category is an individual (no business name required).
 */
export function isIndividualOccupation(cat?: string | null): boolean {
  if (!cat) return true;
  const lower = cat.toLowerCase();
  return (
    lower.includes('individual') ||
    lower.includes('student') ||
    lower.includes('influencer') ||
    lower.includes('creator') ||
    lower.includes('working') ||
    lower.includes('professional') ||
    lower.includes('freelancer')
  );
}

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

export const publicPartnerRegisterSchema = z
  .object({
    firstName: z.string().trim().max(60, 'First name must be at most 60 characters').optional().nullable(),
    lastName: z.string().trim().max(60, 'Last name must be at most 60 characters').optional().nullable(),
    fullName: z.string().trim().max(125, 'Full name must be at most 125 characters').optional().nullable(),
    phone: z
      .string({ required_error: 'Mobile number is required' })
      .transform(normalizeIndianPhone)
      .refine((val) => INDIAN_PHONE_REGEX.test(val), {
        message: 'Please enter a valid 10-digit Indian mobile number starting with 6–9'
      }),
    whatsapp: z
      .string()
      .transform(normalizeIndianPhone)
      .refine((val) => !val || INDIAN_PHONE_REGEX.test(val), {
        message: 'Please enter a valid 10-digit Indian WhatsApp number starting with 6–9'
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
    category: z.string().trim().max(100).optional().nullable(),
    occupation: z.string().trim().max(100).optional().nullable(),
    gender: z
      .string({ required_error: 'Please select your gender' })
      .trim()
      .min(1, 'Please select your gender')
      .max(30),
    age: z.preprocess(
      (val) => (val === null || val === '' || val === undefined ? undefined : val),
      z.coerce
        .number({
          required_error: 'Age is required (must be 18 or older)',
          invalid_type_error: 'Please enter a valid age'
        })
        .int('Age must be a whole number')
        .min(18, 'You must be at least 18 years old to join the IOTA Affiliate Program')
        .max(100, 'Please enter a valid age between 18 and 100')
    ),
    socialLink: z.string().trim().max(300, 'Social media link must be at most 300 characters').optional().nullable(),
    otherBusiness: z.string().trim().max(150, 'Profession / business specification must be at most 150 characters').optional().nullable(),
    businessName: z.string().trim().max(150, 'Business / Institute name must be at most 150 characters').optional().nullable(),
    address: z.string().trim().max(300, 'Address must be at most 300 characters').optional().nullable(),
    state: z
      .string({ required_error: 'State is required' })
      .trim()
      .min(2, 'State is required'),
    pincode: z
      .string({ required_error: 'Pincode is required' })
      .trim()
      .regex(/^\d{6}$/, 'Please enter a valid 6-digit PIN code'),
    notes: z.string().trim().max(500, 'Notes must be at most 500 characters').optional().nullable()
  })
  .superRefine((data, ctx) => {
    const chosen = (data.occupation || data.category || '').trim();
    const lower = chosen.toLowerCase();

    const fullName = (data.fullName || `${data.firstName || ''} ${data.lastName || ''}`).trim();
    if (!fullName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['firstName'],
        message: 'Full name is required'
      });
    }

    if ((lower.includes('influencer') || lower.includes('creator')) && !data.socialLink?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['socialLink'],
        message: 'Please provide your social media profile link for creator verification'
      });
    }

    if (lower.includes('other') && !data.otherBusiness?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['otherBusiness'],
        message: 'Please specify your profession or business'
      });
    }

    if (chosen && !isIndividualOccupation(chosen) && !data.businessName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessName'],
        message: 'Please enter your Business / Institute Name'
      });
    }
  });

export type PublicPartnerRegisterInput = z.infer<typeof publicPartnerRegisterSchema>;
