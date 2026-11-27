import { z } from 'zod';
import { PartnerCategory, AffiliateStatus, PremisesStatus, Role } from '../shared';

// Create Counselor or Sales User
export const createStaffSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').trim(),
  email: z.string().email('Valid email address is required').toLowerCase().trim(),
  phone: z.string().min(7, 'Valid phone number is required (at least 7 digits)').trim(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
  role: z.preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum([Role.COUNSELLOR, Role.SALES], {
      errorMap: () => ({ message: "Role must be 'COUNSELLOR' or 'SALES'" })
    })
  ),
  territory: z.string().optional(),
  assignedTerritory: z.string().optional()
});

export const updateStaffStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive boolean flag is required' })
});

export const updateStaffSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').trim().optional(),
  email: z.string().email('Valid email is required').toLowerCase().trim().optional(),
  phone: z.string().min(10, 'Valid 10-digit phone number is required').trim().optional(),
  isActive: z.boolean().optional()
});

export const resetStaffPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters').trim()
});

// Affiliate Approval / Rejection
export const partnerApprovalSchema = z.object({
  status: z.enum([
    AffiliateStatus.ACTIVE,
    AffiliateStatus.PROFILE_REJECTED,
    AffiliateStatus.KYC_PENDING,
    AffiliateStatus.KYC_SUBMITTED,
    AffiliateStatus.KYC_REJECTED,
    AffiliateStatus.KYC_REVISED,
    AffiliateStatus.SUSPENDED,
    AffiliateStatus.INACTIVE
  ]),
  rejectionReason: z.string().optional(),
  kycRevisionRemark: z.string().optional()
}).refine(
  (data) => {
    if (data.status === AffiliateStatus.PROFILE_REJECTED && !data.rejectionReason?.trim()) {
      return false;
    }
    if (
      data.status === AffiliateStatus.KYC_REJECTED &&
      !data.kycRevisionRemark?.trim() &&
      !data.rejectionReason?.trim()
    ) {
      return false;
    }
    return true;
  },
  { message: 'Remark is mandatory when rejecting an affiliate or requesting KYC revision', path: ['rejectionReason'] }
);

// Premises Schema
export const createPremisesSchema = z.object({
  premisesName: z.string().min(2, 'Premises business name is required').trim(),
  category: z.nativeEnum(PartnerCategory).default(PartnerCategory.COMPUTER_CENTER),
  customCategory: z.string().optional().nullable(),
  contactNumber: z.string().min(7, 'Valid contact number is required').trim(),
  website: z.string().optional().nullable(),
  googleMapUrl: z.string().optional().nullable(),
  fullAddress: z.string().min(5, 'Full address is required').trim(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  assignedSalesId: z.string().uuid().optional().nullable()
});

export const updatePremisesSchema = z.object({
  premisesName: z.string().min(2, 'Premises business name is required').trim().optional(),
  category: z.nativeEnum(PartnerCategory).optional(),
  customCategory: z.string().optional().nullable(),
  contactNumber: z.string().min(7, 'Valid contact number is required').trim().optional(),
  website: z.string().optional().nullable(),
  googleMapUrl: z.string().optional().nullable(),
  fullAddress: z.string().min(5, 'Full address is required').trim().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  assignedSalesId: z.string().uuid().optional().nullable()
});

export const bulkImportPremisesSchema = z.object({
  premisesList: z.array(createPremisesSchema).min(1, 'At least one premises record is required')
});

// Visit Assignment Schema
export const assignVisitSchema = z.object({
  premisesId: z.string().uuid('Valid premises ID required'),
  salespersonId: z
    .union([z.string().uuid(), z.literal('UNASSIGN'), z.literal(''), z.null()])
    .optional(),
  scheduledDate: z
    .string()
    .refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Invalid date format' })
    .optional()
});

export const unassignVisitSchema = z.object({
  premisesId: z.string().uuid('Valid premises ID required')
});

export const bulkAssignVisitsSchema = z.object({
  premisesIds: z.array(z.string().uuid()).min(1, 'At least one premises ID is required'),
  salespersonId: z.string().uuid('Valid salesperson ID required'),
  scheduledDate: z
    .string()
    .refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Invalid date format' })
    .optional()
});

// Lead Reassignment Schema
export const reassignLeadSchema = z.object({
  counsellorId: z.string().uuid('Valid counselor ID required'),
  remarks: z.string().optional()
});

// Contact enquiry Status Update Schema
export const updateContactStatusSchema = z.object({
  status: z.enum(['NEW', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED']).optional(),
  adminNotes: z.string().optional().nullable()
});

// Affiliate Support Ticket Status & Notes Update Schema
export const updateSupportTicketSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  adminNotes: z.string().trim().max(2000).optional().nullable()
});


