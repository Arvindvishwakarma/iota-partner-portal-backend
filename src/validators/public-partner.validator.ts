import { z } from 'zod';
import { normalizeIndianPhone } from './public-lead.validator';
import { INDIAN_PHONE_REGEX, PartnerCategory } from '../shared';

/**
 * Transforms any string into Capital Case (Title Case).
 * E.g., "arvind" -> "Arvind", "indore" -> "Indore", "arvind kumar" -> "Arvind Kumar".
 */
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

/**
 * Single source of truth for whether an occupation/category is an individual (no firm name required).
 */
export function isIndividualOccupation(cat?: string | null): boolean {
  if (!cat) return true;
  const lower = cat.toLowerCase();
  if (
    lower.includes('business') ||
    lower.includes('firm') ||
    lower.includes('other') ||
    lower.includes('shop') ||
    lower.includes('library') ||
    lower.includes('hostel') ||
    lower.includes('center') ||
    lower.includes('institute') ||
    lower.includes('coaching')
  ) {
    return false;
  }
  return (
    lower.includes('student') ||
    lower.includes('influencer') ||
    lower.includes('creator') ||
    lower.includes('working') ||
    lower.includes('professional') ||
    lower.includes('freelancer') ||
    lower.includes('educator') ||
    lower.includes('tutor') ||
    lower.includes('individual')
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
  if (lower.includes('educator') || lower.includes('tutor') || lower.includes('education') || lower.includes('school') || lower.includes('college')) {
    return PartnerCategory.EDUCATIONAL_INSTITUTE;
  }
  return PartnerCategory.OTHER;
}

export const publicPartnerRegisterSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .max(60, 'First name must be at most 60 characters')
      .optional()
      .nullable()
      .transform((val) => (val ? toCapitalCase(val) : val)),
    lastName: z
      .string()
      .trim()
      .max(60, 'Last name must be at most 60 characters')
      .optional()
      .nullable()
      .transform((val) => (val ? toCapitalCase(val) : val)),
    fullName: z
      .string()
      .trim()
      .max(125, 'Full name must be at most 125 characters')
      .optional()
      .nullable()
      .transform((val) => (val ? toCapitalCase(val) : val)),
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
      .string({ required_error: 'Email address is required' })
      .trim()
      .min(1, 'Email address is required')
      .email('Please enter a valid email address'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Za-z]/, 'Password must contain at least one alphabet letter')
      .regex(/[0-9]/, 'Password must contain at least one digit (0–9)')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    confirmPassword: z.string({ required_error: 'Please confirm your password' }),
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
        .min(18, 'You must be at least 18 years old to join the IOTA Academy Affiliate Program')
        .max(99, 'Age must be less than 100 (Age >= 18 and < 100)')
    ),
    socialLink: z.string().trim().max(1000, 'Social media link must be at most 1000 characters').optional().nullable(),
    otherBusiness: z.string().trim().max(150, 'Occupation specification must be at most 150 characters').optional().nullable(),
    businessName: z.string().trim().max(150, 'Firm Name must be at most 150 characters').optional().nullable(),
    address: z
      .string({ required_error: 'Communication address is required' })
      .trim()
      .min(3, 'Please enter your communication address')
      .max(300, 'Communication address must be at most 300 characters'),
    city: z
      .string({ required_error: 'City is required' })
      .trim()
      .min(2, 'Please enter your city')
      .max(100, 'City must be at most 100 characters')
      .optional()
      .nullable()
      .transform((val) => (val ? toCapitalCase(val) : val)),
    state: z
      .string({ required_error: 'State is required' })
      .trim()
      .min(2, 'State is required'),
    pincode: z
      .string({ required_error: 'Pincode is required' })
      .trim()
      .regex(/^\d{6}$/, 'Please enter a valid 6-digit PIN code'),
    whatsappVerificationToken: z.string().trim().optional().nullable(),
    emailVerificationToken: z.string().trim().optional().nullable(),
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

    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'Passwords do not match (case-sensitive)'
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
        message: 'Please specify your occupation'
      });
    }

    if (chosen && !isIndividualOccupation(chosen) && !data.businessName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessName'],
        message: 'Please enter your Firm Name'
      });
    }
  });

export type PublicPartnerRegisterInput = z.infer<typeof publicPartnerRegisterSchema>;
