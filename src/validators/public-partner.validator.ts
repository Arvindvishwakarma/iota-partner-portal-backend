import { z } from 'zod';
import { normalizeIndianPhone } from './public-lead.validator';
import { Gender, INDIAN_PHONE_REGEX, Occupation } from '../shared';

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

export const publicPartnerRegisterSchema = z
  .object({
    firstName: z
      .string({ required_error: 'First name is required' })
      .trim()
      .min(1, 'First name is required')
      .max(60, 'First name must be at most 60 characters')
      .transform((val) => toCapitalCase(val)),
    lastName: z
      .string({ required_error: 'Last name is required' })
      .trim()
      .min(1, 'Last name is required')
      .max(60, 'Last name must be at most 60 characters')
      .transform((val) => toCapitalCase(val)),
    gender: z.nativeEnum(Gender, {
      errorMap: () => ({ message: 'Please select Male, Female, or Other' })
    }),
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
    mobileNumber: z
      .string({ required_error: 'Mobile number is required' })
      .transform(normalizeIndianPhone)
      .refine((val) => INDIAN_PHONE_REGEX.test(val), {
        message: 'Please enter a valid 10-digit Indian mobile number starting with 6–9'
      }),
    whatsappNumber: z
      .string({ required_error: 'WhatsApp number is required' })
      .transform(normalizeIndianPhone)
      .refine((val) => INDIAN_PHONE_REGEX.test(val), {
        message: 'Please enter a valid 10-digit Indian WhatsApp number starting with 6–9'
      }),
    emailAddress: z
      .string({ required_error: 'Email address is required' })
      .trim()
      .min(1, 'Email address is required')
      .max(255, 'Email address must be at most 255 characters')
      .email('Please enter a valid email address'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Za-z]/, 'Password must contain at least one alphabet letter')
      .regex(/[0-9]/, 'Password must contain at least one digit (0–9)')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    confirmPassword: z.string({ required_error: 'Please confirm your password' }),
    communicationAddress: z
      .string({ required_error: 'Communication address is required' })
      .trim()
      .min(3, 'Please enter your communication address')
      .max(300, 'Communication address must be at most 300 characters'),
    city: z
      .string({ required_error: 'City is required' })
      .trim()
      .min(2, 'Please enter your city')
      .max(80, 'City must be at most 80 characters')
      .transform((val) => toCapitalCase(val)),
    state: z
      .string({ required_error: 'State is required' })
      .trim()
      .min(2, 'State is required')
      .max(80, 'State must be at most 80 characters'),
    pincode: z
      .string({ required_error: 'Pincode is required' })
      .trim()
      .regex(/^\d{6}$/, 'Please enter a valid 6-digit PIN code'),
    tellUsMoreAboutYourself: z
      .string()
      .trim()
      .max(500, 'Bio must be at most 500 characters')
      .optional()
      .nullable(),
    occupation: z.nativeEnum(Occupation, {
      errorMap: () => ({ message: 'Please select a valid occupation' })
    }),

    // Conditional occupation fields collected during registration (remaining occupation fields are collected during KYC)
    influencerLinks: z
      .array(z.string().trim().max(300, 'Each social link must be at most 300 characters'))
      .max(5, 'Maximum 5 social links allowed')
      .optional()
      .nullable(),
    firmName: z.string().trim().max(150).optional().nullable(),
    specifyOccupation: z.string().trim().max(150).optional().nullable(),
    otherOccupationName: z.string().trim().max(150).optional().nullable(),
    otherOccupationDescribe: z.string().trim().max(1000).optional().nullable(),

    whatsappVerificationToken: z.string().trim().optional().nullable(),
    emailVerificationToken: z.string().trim().optional().nullable()
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'Passwords do not match (case-sensitive)'
      });
    }

    switch (data.occupation) {
      case Occupation.INFLUENCER: {
        const links = (data.influencerLinks || []).map((l) => l.trim()).filter(Boolean);
        if (links.length === 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['influencerLinks'], message: 'Please provide at least one social media profile link' });
        }
        break;
      }

      case Occupation.OTHER:
        if (!data.otherOccupationName?.trim() && !data.specifyOccupation?.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['otherOccupationName'], message: 'Please specify your occupation name' });
        }
        if (!data.otherOccupationDescribe?.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['otherOccupationDescribe'], message: 'Please describe your occupation' });
        }
        break;

      default:
        break;
    }
  });

export type PublicPartnerRegisterInput = z.infer<typeof publicPartnerRegisterSchema>;
