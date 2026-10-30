import { z } from 'zod';
import { PartnerCategory, PartnerStatus, PremisesStatus, Role } from '../shared';

// Create Counselor or Sales User
export const createStaffSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').trim(),
  email: z.string().email('Valid email is required').toLowerCase().trim(),
  phone: z.string().min(10, 'Valid 10-digit phone number is required').trim(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  role: z.enum([Role.COUNSELLOR, Role.SALES], {
    errorMap: () => ({ message: "Role must be 'COUNSELLOR' or 'SALES'" })
  })
});

export const updateStaffStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive boolean flag is required' })
});

// Partner Approval / Rejection
export const partnerApprovalSchema = z.object({
  status: z.enum([PartnerStatus.ACTIVE, PartnerStatus.REJECTED, PartnerStatus.SUSPENDED]),
  rejectionReason: z.string().optional()
}).refine(
  (data) => {
    if (data.status === PartnerStatus.REJECTED && !data.rejectionReason) {
      return false;
    }
    return true;
  },
  { message: 'Rejection reason is mandatory when rejecting a partner registration', path: ['rejectionReason'] }
);

// Premises Schema
export const createPremisesSchema = z.object({
  premisesName: z.string().min(2, 'Premises name is required').trim(),
  category: z.nativeEnum(PartnerCategory).default(PartnerCategory.COMPUTER_CENTER),
  ownerName: z.string().min(2, 'Owner name is required').trim(),
  contactPerson: z.string().optional(),
  mobile: z.string().min(10, 'Valid phone number is required').trim(),
  altMobile: z.string().optional(),
  addressLine1: z.string().min(3, 'Address is required').trim(),
  addressLine2: z.string().optional(),
  city: z.string().min(2, 'City is required').trim(),
  area: z.string().min(2, 'Area is required').trim(),
  pincode: z.string().min(5, 'Valid pincode is required').trim(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  assignedSalesId: z.string().uuid().optional()
});

export const bulkImportPremisesSchema = z.object({
  premisesList: z.array(createPremisesSchema).min(1, 'At least one premises record is required')
});

// Visit Assignment Schema
export const assignVisitSchema = z.object({
  premisesId: z.string().uuid('Valid premises ID required'),
  salespersonId: z.string().uuid('Valid salesperson ID required'),
  scheduledDate: z.string().datetime().optional()
});

export const bulkAssignVisitsSchema = z.object({
  premisesIds: z.array(z.string().uuid()).min(1, 'At least one premises ID is required'),
  salespersonId: z.string().uuid('Valid salesperson ID required'),
  scheduledDate: z.string().datetime().optional()
});

// Lead Reassignment Schema
export const reassignLeadSchema = z.object({
  counsellorId: z.string().uuid('Valid counselor ID required'),
  remarks: z.string().optional()
});

