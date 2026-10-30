import { z } from 'zod';
import { PartnerCategory, VisitStatus } from '../shared';

export const checkInSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().optional()
});

export const checkOutSchema = z.object({
  status: z.enum([
    VisitStatus.COMPLETED,
    VisitStatus.INTERESTED,
    VisitStatus.NOT_INTERESTED,
    VisitStatus.FOLLOW_UP_REQUIRED,
    VisitStatus.PARTNER_ONBOARDED,
    VisitStatus.INVALID_CONTACT
  ], {
    errorMap: () => ({ message: 'Valid visit outcome status is required' })
  }),
  remarks: z.string().min(3, 'Visit outcome notes must be at least 3 characters').max(1000),
  photoUrl: z.string().url().optional().nullable(),
  scheduledDate: z.string().datetime().optional().nullable()
});

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
  upiId: z.string().optional().nullable()
});

export type CheckInInput = z.infer<typeof checkInSchema>;
export type CheckOutInput = z.infer<typeof checkOutSchema>;
export type OnboardPartnerInput = z.infer<typeof onboardPartnerSchema>;

