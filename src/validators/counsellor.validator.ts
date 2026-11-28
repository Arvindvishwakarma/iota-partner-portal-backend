import { z } from 'zod';
import { LeadActivityType } from '../shared';
import { findPipelineStage } from '../shared/pipeline-statuses';

const ALLOWED_INTERACTION_TYPES = [
  LeadActivityType.PHONE_CALL,
  LeadActivityType.WHATSAPP_MESSAGE,
  LeadActivityType.SMS,
  LeadActivityType.EMAIL,
  LeadActivityType.IN_PERSON_MEETING,
  LeadActivityType.DEMO_INTERACTION,
  LeadActivityType.OTHER,
  LeadActivityType.NOTE_ADDED,
  LeadActivityType.OFFICE_VISIT_SCHEDULED,
  LeadActivityType.DEMO_SCHEDULED
] as const;

export const logActivitySchema = z.object({
  activityType: z.enum(ALLOWED_INTERACTION_TYPES, {
    errorMap: () => ({ message: 'Invalid interaction type' })
  }),
  remarks: z.string().trim().min(2, 'Interaction notes must be at least 2 characters').max(1500),
  scheduledFor: z.string().datetime().optional().nullable()
});

export const updateLeadStatusSchema = z
  .object({
    status: z.string().trim().min(1, 'Status is required'),
    subStatus: z.string().trim().max(80).optional().nullable(),
    remarks: z.string().trim().max(1000).optional(),
    reason: z.string().trim().max(500).optional(),
    registrationAmount: z.number().nonnegative().optional(),
    paidFee: z.number().nonnegative().optional(),
    scheduledFor: z.string().datetime().optional().nullable(),
    // Conditional structured fields
    demoMode: z.enum(['Online', 'Offline']).optional().nullable(),
    demoDate: z.string().trim().max(30).optional().nullable(),
    demoTime: z.string().trim().max(30).optional().nullable(),
    demoFaculty: z.enum(['Abhishek Sir', 'Hemant Sir', 'Shivam Sir']).optional().nullable(),
    rescheduleReason: z.string().trim().max(500).optional().nullable(),
    callbackDate: z.string().trim().max(30).optional().nullable(),
    callbackTime: z.string().trim().max(30).optional().nullable(),
    cancellationReason: z.string().trim().max(500).optional().nullable(),
    admissionMode: z.enum(['Online', 'Offline']).optional().nullable(),
    courseId: z.string().uuid().optional().nullable(),
    admissionDate: z.string().trim().max(30).optional().nullable(),
    paymentStatus: z.enum(['Full Paid', 'Partial Paid', 'Pending']).optional().nullable()
  })
  .superRefine((data, ctx) => {
    const stage = findPipelineStage(data.status);
    if (!stage) return;

    const cleanSub = (data.subStatus || '').trim();
    if (stage.subStatuses.length > 0) {
      if (!cleanSub || !stage.subStatuses.includes(cleanSub)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['subStatus'],
          message: `Please select a valid substatus for "${stage.mainStatus}"`
        });
        return;
      }
    } else if (cleanSub) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subStatus'],
        message: `"${stage.mainStatus}" does not support substatuses`
      });
      return;
    }

    const cleanRemark = (data.remarks || '').trim();

    if (stage.mainStatus === 'Closed') {
      if (cleanSub === 'Other' && cleanRemark.length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['remarks'],
          message: 'Please provide a detailed explanation (at least 10 characters) when selecting "Other"'
        });
      } else if (cleanRemark.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['remarks'],
          message: 'Remark is mandatory when closing a referral'
        });
      }
    }

    if (stage.mainStatus === 'Cancelled') {
      if (!data.cancellationReason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cancellationReason'],
          message: 'Cancellation reason is mandatory'
        });
      }
      if (cleanRemark.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['remarks'],
          message: 'Remark is mandatory when cancelling a referral'
        });
      }
    }

    if (stage.mainStatus === 'Demo In Progress') {
      if (cleanSub === 'Demo Booked' || cleanSub === 'Online Demo Booked' || cleanSub === 'Offline Demo Booked') {
        if (!data.demoMode) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['demoMode'], message: 'Demo mode is required' });
        }
        if (!data.demoDate?.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['demoDate'], message: 'Demo date is required' });
        }
        if (!data.demoTime?.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['demoTime'], message: 'Demo time is required' });
        }
        if (!data.demoFaculty) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['demoFaculty'], message: 'Demo faculty is required' });
        }
      } else if (cleanSub === 'Demo Rescheduled') {
        if (!data.demoDate?.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['demoDate'], message: 'New demo date is required' });
        }
        if (!data.demoTime?.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['demoTime'], message: 'New demo time is required' });
        }
      }
    }

    if (stage.mainStatus === 'Joined') {
      if (!data.admissionMode) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['admissionMode'], message: 'Admission mode is required' });
      }
      if (!data.admissionDate?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['admissionDate'], message: 'Admission date is required' });
      }
      if (!data.paymentStatus) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentStatus'], message: 'Payment status is required' });
      }
    }
  });

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

