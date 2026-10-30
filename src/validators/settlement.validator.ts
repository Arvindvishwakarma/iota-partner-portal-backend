import { z } from 'zod';
import { AdmissionStatus, SettlementStatus } from '../shared';

export const verifyAdmissionSchema = z.object({
  approved: z.boolean(),
  rejectionReason: z.string().max(500).optional()
}).refine(
  (data) => {
    if (!data.approved && !data.rejectionReason) {
      return false;
    }
    return true;
  },
  {
    message: 'Rejection reason is mandatory when declining admission verification',
    path: ['rejectionReason']
  }
);

export const refundAdmissionSchema = z.object({
  refundReason: z.string().min(3, 'Refund/cancellation reason must be at least 3 characters').max(500),
  refundAmount: z.number().positive('Refund amount must be greater than zero')
});

export const generateSettlementBatchSchema = z.object({
  periodStartDate: z.string().optional(),
  periodEndDate: z.string().optional(),
  partnerId: z.string().uuid().optional().nullable()
});

export const disburseSettlementSchema = z.object({
  transactionRef: z.string().min(5, 'Valid Bank UTR / Transaction Reference must be at least 5 characters').max(100),
  paymentMode: z.enum(['NEFT', 'IMPS', 'RTGS', 'UPI'], {
    errorMap: () => ({ message: 'Payment mode must be NEFT, IMPS, RTGS, or UPI' })
  }),
  paymentProofUrl: z.string().url().optional().nullable(),
  transactedAt: z.string().datetime().optional()
});

export type VerifyAdmissionInput = z.infer<typeof verifyAdmissionSchema>;
export type RefundAdmissionInput = z.infer<typeof refundAdmissionSchema>;
export type GenerateSettlementBatchInput = z.infer<typeof generateSettlementBatchSchema>;
export type DisburseSettlementInput = z.infer<typeof disburseSettlementSchema>;

