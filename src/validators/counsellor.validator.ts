import { z } from 'zod';
import { LeadActivityType, LeadStatus } from '../shared';

export const logActivitySchema = z.object({
  activityType: z.nativeEnum(LeadActivityType, {
    errorMap: () => ({ message: 'Invalid activity type' })
  }),
  remarks: z.string().min(2, 'Activity notes/remarks must be at least 2 characters').max(1000),
  scheduledFor: z.string().datetime().optional().nullable()
});

export const updateLeadStatusSchema = z.object({
  status: z.nativeEnum(LeadStatus, {
    errorMap: () => ({ message: 'Invalid lead status' })
  }),
  remarks: z.string().max(500).optional(),
  reason: z.string().max(500).optional(),
  scheduledFor: z.string().datetime().optional().nullable()
}).refine(
  (data) => {
    if (
      (data.status === LeadStatus.LOST ||
        data.status === LeadStatus.NOT_INTERESTED ||
        data.status === LeadStatus.INVALID_CONTACT) &&
      !data.reason &&
      !data.remarks
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'A specific reason or remark is mandatory when dropping or marking a lead as not interested',
    path: ['reason']
  }
);

export const convertAdmissionSchema = z.object({
  courseId: z.string().uuid('Valid course ID is required'),
  totalFee: z.number().positive('Total course fee must be greater than 0'),
  paidFee: z.number().nonnegative('Initial paid fee cannot be negative'),
  paymentMode: z.enum(['UPI', 'CASH', 'NET_BANKING', 'CARD', 'NEFT', 'CHEQUE'], {
    errorMap: () => ({ message: 'Valid payment mode is required (UPI, CASH, NET_BANKING, etc.)' })
  }),
  referenceNumber: z.string().max(100).optional(),
  remarks: z.string().max(500).optional()
}).refine((data) => data.paidFee <= data.totalFee, {
  message: 'Initial paid fee cannot exceed total course fee',
  path: ['paidFee']
});

export type LogActivityInput = z.infer<typeof logActivitySchema>;
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>;
export type ConvertAdmissionInput = z.infer<typeof convertAdmissionSchema>;

