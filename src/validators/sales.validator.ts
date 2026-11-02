import { z } from 'zod';
import { PartnerCategory, VisitStatus } from '../shared';

export const checkInSchema = z.object({
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  accuracyMeters: z.number().optional().nullable()
});

export const updateVisitStatusSchema = z.object({
  status: z.nativeEnum(VisitStatus),
  remarks: z.string().optional().default(''),
  photoUrl: z.string().optional().nullable(),
  scheduledDate: z
    .string()
    .refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Invalid next visit date format' })
    .optional()
    .nullable()
});

export const checkOutSchema = updateVisitStatusSchema;

export const onboardPartnerSchema = z.object({
  premisesId: z.string().uuid().optional().nullable(),
  businessName: z.string().min(3, 'Business name must be at least 3 characters').max(100),
  category: z.nativeEnum(PartnerCategory),
  ownerName: z.string().min(2, 'Owner name must be at least 2 characters').max(100),
  contactPerson: z.string().max(100).optional(),
  email: z.string().email('Valid business/owner email is required'),
  mobile: z.string().regex(/^[6-9]\d{9}$/, 'Valid 10-digit Indian mobile number is required'),
  whatsapp: z.string().regex(/^[6-9]\d{9}$/, 'Valid 10-digit WhatsApp number').optional().nullable(),
  addressLine1: z.string().min(5, 'Address is required').max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(2).max(50),
  area: z.string().min(2).max(50),
  pincode: z.string().regex(/^\d{6}$/, 'Valid 6-digit Indian PIN code is required'),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  bankAccountName: z.string().optional().nullable(),
  bankAccountNumber: z.string().optional().nullable(),
  bankIfsc: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  upiId: z.string().optional().nullable(),
  onboardingFormImage: z.string().optional().nullable()
});

export type CheckInInput = z.infer<typeof checkInSchema>;
export type CheckOutInput = z.infer<typeof checkOutSchema>;
export type OnboardPartnerInput = z.infer<typeof onboardPartnerSchema>;

