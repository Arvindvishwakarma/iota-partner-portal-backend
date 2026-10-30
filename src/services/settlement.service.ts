import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import {
  AdmissionStatus,
  CommissionStatus,
  SettlementStatus,
  LeadStatus,
  STUDENT_REFUND_WINDOW_DAYS
} from '../shared';
import {
  DisburseSettlementInput,
  GenerateSettlementBatchInput,
  RefundAdmissionInput,
  VerifyAdmissionInput
} from '../validators/settlement.validator';

export class SettlementService {
  /**
   * Get Student Admissions for Admin Verification Console
   */
  async getAdmissions(filter: { status?: AdmissionStatus; search?: string; page?: number; limit?: number }) {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { admissionCode: { contains: q, mode: 'insensitive' } },
        { lead: { studentName: { contains: q, mode: 'insensitive' } } },
        { lead: { mobile: { contains: q } } }
      ];
    }

    const [total, admissions] = await Promise.all([
      prisma.admission.count({ where }),
      prisma.admission.findMany({
        where,
        include: {
          lead: {
            select: {
              id: true,
              leadCode: true,
              studentName: true,
              mobile: true,
              city: true,
              partner: {
                select: { id: true, partnerCode: true, businessName: true }
              }
            }
          },
          course: {
            select: { id: true, code: true, name: true, feeAmount: true }
          },
          commission: true,
          payments: { orderBy: { paymentDate: 'desc' } }
        },
        orderBy: { admissionDate: 'desc' },
        skip,
        take: limit
      })
    ]);

    return {
      admissions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Admin Verify or Reject Admission
   */
  async verifyAdmission(adminUserId: string, admissionId: string, input: VerifyAdmissionInput) {
    const admission = await prisma.admission.findUnique({
      where: { id: admissionId },
      include: { commission: true, lead: true }
    });

    if (!admission) {
      throw new AppError('Admission record not found', 404, 'NOT_FOUND');
    }

    if (admission.status !== AdmissionStatus.PENDING_VERIFICATION) {
      throw new AppError(
        `Cannot verify admission with status '${admission.status}'. It must be PENDING_VERIFICATION.`,
        400,
        'INVALID_ADMISSION_STATUS'
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      if (input.approved) {
        // Calculate days elapsed since admissionDate
        const daysElapsed = Math.floor(
          (Date.now() - new Date(admission.admissionDate).getTime()) / (1000 * 60 * 60 * 24)
        );

        // If >= 14 days, commission is immediately ELIGIBLE for settlement
        const commissionStatus =
          daysElapsed >= STUDENT_REFUND_WINDOW_DAYS
            ? CommissionStatus.ELIGIBLE
            : CommissionStatus.PENDING;

        const updatedAdmission = await tx.admission.update({
          where: { id: admissionId },
          data: {
            status: AdmissionStatus.VERIFIED,
            verifiedByUserId: adminUserId,
            verifiedAt: new Date()
          }
        });

        if (admission.commission) {
          await tx.partnerCommission.update({
            where: { id: admission.commission.id },
            data: { status: commissionStatus }
          });
        }

        return updatedAdmission;
      } else {
        // Rejection
        const updatedAdmission = await tx.admission.update({
          where: { id: admissionId },
          data: {
            status: AdmissionStatus.REJECTED,
            rejectionReason: input.rejectionReason,
            verifiedByUserId: adminUserId,
            verifiedAt: new Date()
          }
        });

        // Cancel commission
        if (admission.commission) {
          await tx.partnerCommission.update({
            where: { id: admission.commission.id },
            data: {
              status: CommissionStatus.REVERSED,
              reversalReason: input.rejectionReason || 'Admission verification rejected by administration'
            }
          });
        }

        // Move lead to LOST
        await tx.lead.update({
          where: { id: admission.leadId },
          data: { status: LeadStatus.LOST }
        });

        return updatedAdmission;
      }
    });

    return result;
  }

  /**
   * Process Student Refund & Trigger 14-Day Clawback Policy
   */
  async refundAdmission(adminUserId: string, admissionId: string, input: RefundAdmissionInput) {
    const admission = await prisma.admission.findUnique({
      where: { id: admissionId },
      include: { commission: true, lead: true }
    });

    if (!admission) {
      throw new AppError('Admission record not found', 404, 'NOT_FOUND');
    }

    if (admission.status === AdmissionStatus.REFUNDED) {
      throw new AppError('This admission has already been refunded', 400, 'ALREADY_REFUNDED');
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark Admission as REFUNDED
      const updatedAdmission = await tx.admission.update({
        where: { id: admissionId },
        data: {
          status: AdmissionStatus.REFUNDED,
          refundDate: new Date(),
          rejectionReason: `[Refund Processed] ${input.refundReason}`
        }
      });

      // 2. Adjust or Cancel Commission
      if (admission.commission) {
        if (
          admission.commission.status === CommissionStatus.PENDING ||
          admission.commission.status === CommissionStatus.ELIGIBLE
        ) {
          // If not yet disbursed to bank, cancel directly
          await tx.partnerCommission.update({
            where: { id: admission.commission.id },
            data: {
              status: CommissionStatus.REVERSED,
              reversalReason: `Student refund within cooling-off policy: ${input.refundReason}`
            }
          });
        } else if (admission.commission.status === CommissionStatus.PAID) {
          // If already settled, mark commission as DISPUTED/CANCELLED and queue clawback adjustment
          await tx.partnerCommission.update({
            where: { id: admission.commission.id },
            data: {
              reversalReason: `CLAWBACK: Student refund after payout. Deduct from next settlement. Reason: ${input.refundReason}`
            }
          });
        }
      }

      // 3. Update Lead Status
      await tx.lead.update({
        where: { id: admission.leadId },
        data: { status: LeadStatus.LOST }
      });

      return updatedAdmission;
    });

    return result;
  }

  /**
   * Get Settlement Batches
   */
  async getSettlements(filter: { status?: SettlementStatus; page?: number; limit?: number }) {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.status) where.status = filter.status;

    const [total, settlements] = await Promise.all([
      prisma.settlement.count({ where }),
      prisma.settlement.findMany({
        where,
        include: {
          partner: {
            select: {
              id: true,
              partnerCode: true,
              businessName: true,
              ownerName: true,
              mobile: true,
              bankAccountName: true,
              bankAccountNumber: true,
              bankIfsc: true,
              bankName: true,
              upiId: true
            }
          },
          transactions: { orderBy: { transactedAt: 'desc' } },
          _count: { select: { commissions: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    return {
      settlements,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get Single Settlement Batch with Itemized Commissions Ledger
   */
  async getSettlementById(settlementId: string) {
    const settlement = await prisma.settlement.findUnique({
      where: { id: settlementId },
      include: {
        partner: true,
        transactions: true,
        commissions: {
          include: {
            admission: {
              include: {
                lead: { select: { studentName: true, leadCode: true } },
                course: { select: { name: true } }
              }
            }
          }
        }
      }
    });

    if (!settlement) {
      throw new AppError('Settlement batch not found', 404, 'NOT_FOUND');
    }

    return settlement;
  }

  /**
   * Automatically Advance Commissions Past 14-Day Cooling-off to ELIGIBLE
   */
  async evaluateCoolingOffWindow() {
    const fourteenDaysAgo = new Date(Date.now() - STUDENT_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const updated = await prisma.partnerCommission.updateMany({
      where: {
        status: CommissionStatus.PENDING,
        settlementId: null,
        admission: {
          status: AdmissionStatus.VERIFIED,
          admissionDate: { lte: fourteenDaysAgo }
        }
      },
      data: {
        status: CommissionStatus.ELIGIBLE
      }
    });

    return updated.count;
  }

  /**
   * Generate Fortnightly Settlement Batch (1st & 15th cycles)
   */
  async generateSettlementBatch(adminUserId: string, input: GenerateSettlementBatchInput) {
    // 1. Advance cooling-off commissions first
    await this.evaluateCoolingOffWindow();

    const periodStartDate = input.periodStartDate
      ? new Date(input.periodStartDate)
      : new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const periodEndDate = input.periodEndDate ? new Date(input.periodEndDate) : new Date();

    const where: any = {
      status: CommissionStatus.ELIGIBLE,
      settlementId: null
    };

    if (input.partnerId) {
      where.partnerId = input.partnerId;
    }

    // 2. Find eligible commissions
    const eligibleCommissions = await prisma.partnerCommission.findMany({
      where,
      include: { partner: true }
    });

    if (eligibleCommissions.length === 0) {
      throw new AppError(
        'No eligible commissions found for settlement. Commissions must be past the 14-day cooling-off verification period.',
        400,
        'NO_ELIGIBLE_COMMISSIONS'
      );
    }

    // 3. Group by partnerId
    const partnerGroups = new Map<string, typeof eligibleCommissions>();
    for (const comm of eligibleCommissions) {
      const existing = partnerGroups.get(comm.partnerId) || [];
      existing.push(comm);
      partnerGroups.set(comm.partnerId, existing);
    }

    const createdSettlements: any[] = [];

    // 4. Create batches for each partner in transaction
    await prisma.$transaction(async (tx) => {
      for (const [partnerId, commList] of partnerGroups.entries()) {
        const totalAmount = commList.reduce(
          (sum, c) => sum.add(new Prisma.Decimal(c.commissionAmount)),
          new Prisma.Decimal(0)
        );

        const adjustmentAmount = new Prisma.Decimal(0);
        const netPaidAmount = totalAmount.sub(adjustmentAmount);

        const timestamp = Date.now().toString().slice(-4);
        const suffix = Math.floor(100 + Math.random() * 900);
        const settlementCode = `SET-2026-${timestamp}${suffix}`;

        const settlement = await tx.settlement.create({
          data: {
            settlementCode,
            partnerId,
            totalAmount,
            adjustmentAmount,
            netPaidAmount,
            status: SettlementStatus.APPROVED,
            periodStartDate,
            periodEndDate,
            approvedByUserId: adminUserId,
            approvedAt: new Date(),
            notes: `Fortnightly automated settlement for ${commList.length} verified student admissions.`
          }
        });

        // Link commissions to this settlement and set to PROCESSING
        await tx.partnerCommission.updateMany({
          where: { id: { in: commList.map((c) => c.id) } },
          data: {
            settlementId: settlement.id,
            status: CommissionStatus.PROCESSING
          }
        });

        createdSettlements.push(settlement);
      }
    });

    return {
      batchesCreated: createdSettlements.length,
      settlements: createdSettlements
    };
  }

  /**
   * Record Bank Disbursal & UTR Transaction Reference (Mark as PAID)
   */
  async disburseSettlement(adminUserId: string, settlementId: string, input: DisburseSettlementInput) {
    const settlement = await prisma.settlement.findUnique({
      where: { id: settlementId },
      include: { partner: true, commissions: true }
    });

    if (!settlement) {
      throw new AppError('Settlement batch not found', 404, 'NOT_FOUND');
    }

    if (settlement.status === SettlementStatus.PAID) {
      throw new AppError('This settlement batch has already been disbursed and marked as PAID', 400, 'ALREADY_PAID');
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create transaction record
      const transaction = await tx.settlementTransaction.create({
        data: {
          settlementId,
          amount: settlement.netPaidAmount,
          paymentMode: input.paymentMode,
          transactionRef: input.transactionRef,
          paymentProofUrl: input.paymentProofUrl || null,
          transactedAt: input.transactedAt ? new Date(input.transactedAt) : new Date()
        }
      });

      // 2. Mark Settlement as PAID
      const updatedSettlement = await tx.settlement.update({
        where: { id: settlementId },
        data: {
          status: SettlementStatus.PAID,
          paidAt: new Date()
        },
        include: { partner: true, transactions: true }
      });

      // 3. Mark all linked PartnerCommissions as PAID
      await tx.partnerCommission.updateMany({
        where: { settlementId },
        data: {
          status: CommissionStatus.PAID
        }
      });

      return {
        settlement: updatedSettlement,
        transaction
      };
    });

    return result;
  }

  /**
   * Overall Financial Summary KPIs
   */
  async getStats() {
    const [
      pendingVerificationCount,
      verifiedEligibleCount,
      totalCommissionsPaid,
      totalSettlementsPaid
    ] = await Promise.all([
      prisma.admission.count({
        where: { status: AdmissionStatus.PENDING_VERIFICATION }
      }),
      prisma.partnerCommission.count({
        where: { status: CommissionStatus.ELIGIBLE, settlementId: null }
      }),
      prisma.partnerCommission.aggregate({
        where: { status: CommissionStatus.PAID },
        _sum: { commissionAmount: true }
      }),
      prisma.settlement.aggregate({
        where: { status: SettlementStatus.PAID },
        _sum: { netPaidAmount: true }
      })
    ]);

    return {
      pendingVerificationCount,
      verifiedEligibleCount,
      totalPaidCommission: totalCommissionsPaid._sum.commissionAmount || 0,
      totalSettlementDisbursed: totalSettlementsPaid._sum.netPaidAmount || 0
    };
  }
}

export const settlementService = new SettlementService();
