import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/error.middleware';
import { generateQrPngDataUrl, generateQrSvgString } from '../utils/qrcode';
import {
  AdmissionStatus,
  CommissionStatus,
  LeadStatus,
  SettlementStatus,
  TicketPriority,
  AffiliateStatus,
  Role,
  STUDENT_REFUND_WINDOW_DAYS,
  JwtUserPayload
} from '../shared';
import { env } from '../config/environment';
import { hashPassword } from '../utils/password';
import { generateAccessToken } from '../utils/jwt';
import {
  PublicPartnerRegisterInput,
  toCapitalCase
} from '../validators/public-partner.validator';
import { generateUniqueAffiliateCode } from '../utils/affiliate-code';
import {
  buildAuthenticatedUser,
  formatAffiliateBusinessName,
  formatFullName,
  formatOccupationLabel,
  toPrismaOccupation
} from '../utils/user-display';
import { RequestWithdrawalInput } from '../validators/settlement.validator';
import { whatsappOtpService } from './whatsapp-otp.service';
import { emailOtpService } from './email-otp.service';

export class PartnerService {
  /**
   * Fetch Partner Dashboard Overview Metrics
   */
  async getDashboard(partnerId: string) {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        affiliateCode: true,
        firstName: true,
        lastName: true,
        firmName: true,
        occupation: true,
        mobileNumber: true,
        whatsappNumber: true,
        emailAddress: true,
        status: true,
        city: true,
        state: true,
        communicationAddress: true,
        registrationUrl: true,
        rejectionReason: true,
        createdAt: true,
        bankAccountHolderName: true,
        bankAccountNumber: true,
        bankIfscNumber: true,
        bankName: true
      }
    });

    if (!affiliate) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');

    const ownerName = formatFullName(affiliate.firstName, affiliate.lastName);
    const businessName = formatAffiliateBusinessName(affiliate);
    const occupationLabel = formatOccupationLabel(affiliate.occupation);

    // If affiliate is not ACTIVE, restrict access to dashboard, referral link, QR code and features
    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      return {
        partner: {
          id: affiliate.id,
          partnerCode: affiliate.affiliateCode,
          affiliateCode: affiliate.affiliateCode,
          businessName,
          ownerName,
          firstName: affiliate.firstName,
          lastName: affiliate.lastName,
          contactPerson: occupationLabel,
          mobile: affiliate.mobileNumber,
          whatsapp: affiliate.whatsappNumber,
          email: affiliate.emailAddress,
          city: affiliate.city,
          state: affiliate.state,
          addressLine1: affiliate.communicationAddress,
          status: affiliate.status,
          registrationUrl: '', // Hide referral link until approved
          rejectionReason: affiliate.rejectionReason,
          createdAt: affiliate.createdAt
        },
        metrics: {
          totalStudentsReferred: 0,
          activeLeads: 0,
          totalEarningsExpected: 0,
          totalEarningsWithdrawable: 0,
          totalLeads: 0,
          todayLeads: 0,
          admissionsCount: 0,
          totalCommission: 0,
          pendingCommission: 0,
          withdrawableCommission: 0,
          paidCommission: 0
        },
        recentLeads: [],
        activeSettlement: null,
        qrPngDataUrl: '',
        qrSvgString: '',
        isRestricted: true
      };
    }

    // Auto promote cooling-off commissions
    const fourteenDaysAgo = new Date(Date.now() - STUDENT_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    await prisma.partnerCommission.updateMany({
      where: {
        partnerId,
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

    const baseUrl = (env.FRONTEND_URL || 'https://affiliate.iotaacademy.in').replace(/\/+$/, '');
    const liveRegistrationUrl = `${baseUrl}/register/${affiliate.affiliateCode}`;

    const [
      totalStudentsReferred,
      activeLeads,
      todayLeads,
      admissionsCount,
      allCommissions,
      recentLeads,
      activeSettlement,
      qrPngDataUrl,
      qrSvgString
    ] = await Promise.all([
      // Card 1: Total unique valid students referred
      prisma.lead.count({
        where: {
          partnerId,
          status: { notIn: [LeadStatus.DUPLICATE_IGNORED, LeadStatus.INVALID_CONTACT] }
        }
      }),
      // Card 2: Active leads in counselling/admission process
      prisma.lead.count({
        where: {
          partnerId,
          status: {
            in: [
              LeadStatus.NEW,
              LeadStatus.CONTACTED,
              LeadStatus.CONNECTED,
              LeadStatus.INTERESTED,
              LeadStatus.FOLLOW_UP_REQUIRED,
              LeadStatus.OFFICE_VISIT_SCHEDULED,
              LeadStatus.OFFICE_VISIT_COMPLETED,
              LeadStatus.DEMO_ATTENDED
            ]
          }
        }
      }),
      prisma.lead.count({
        where: {
          partnerId,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }
      }),
      prisma.lead.count({
        where: { partnerId, status: LeadStatus.ADMISSION_CONFIRMED }
      }),
      // Commissions for eligible courses (course fee > 15,000, admission not rejected/cancelled/refunded)
      prisma.partnerCommission.findMany({
        where: {
          partnerId,
          status: {
            in: [
              CommissionStatus.PENDING,
              CommissionStatus.ELIGIBLE,
              CommissionStatus.PROCESSING,
              CommissionStatus.PAID
            ]
          },
          admission: {
            status: {
              notIn: [
                AdmissionStatus.REJECTED,
                AdmissionStatus.CANCELLED,
                AdmissionStatus.REFUNDED
              ]
            },
            OR: [
              { totalFee: { gt: 15000 } },
              { course: { feeAmount: { gt: 15000 } } }
            ]
          }
        },
        select: {
          id: true,
          commissionAmount: true,
          status: true,
          settlementId: true
        }
      }),
      // Recent student referrals (permitted student info only, no email/phone)
      prisma.lead.findMany({
        where: {
          partnerId,
          status: { notIn: [LeadStatus.DUPLICATE_IGNORED, LeadStatus.INVALID_CONTACT] }
        },
        select: {
          id: true,
          leadCode: true,
          studentName: true,
          createdAt: true,
          status: true,
          interestedCourse: { select: { name: true, feeAmount: true } },
          admission: {
            select: {
              status: true,
              totalFee: true,
              commission: { select: { commissionAmount: true, status: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      prisma.settlement.findFirst({
        where: {
          partnerId,
          status: { in: [SettlementStatus.PENDING_APPROVAL, SettlementStatus.APPROVED] }
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          settlementCode: true,
          totalAmount: true,
          netPaidAmount: true,
          status: true,
          createdAt: true,
          notes: true
        }
      }),
      generateQrPngDataUrl(liveRegistrationUrl),
      generateQrSvgString(liveRegistrationUrl)
    ]);

    // Card 3: Total Earnings Expected (all eligible course commissions)
    const totalEarningsExpected = allCommissions.reduce(
      (acc, item) => acc + (Number(item.commissionAmount) || 0),
      0
    );

    // Card 4: Total Earnings Withdrawable (status ELIGIBLE, not yet in a settlement)
    const totalEarningsWithdrawable = allCommissions
      .filter((i) => i.status === CommissionStatus.ELIGIBLE && !i.settlementId)
      .reduce((acc, item) => acc + (Number(item.commissionAmount) || 0), 0);

    const paidCommission = allCommissions
      .filter((i) => i.status === CommissionStatus.PAID)
      .reduce((acc, item) => acc + (Number(item.commissionAmount) || 0), 0);

    const pendingCommission = allCommissions
      .filter((i) => i.status === CommissionStatus.PENDING)
      .reduce((acc, item) => acc + (Number(item.commissionAmount) || 0), 0);

    return {
      partner: {
        id: affiliate.id,
        partnerCode: affiliate.affiliateCode,
        affiliateCode: affiliate.affiliateCode,
        businessName,
        ownerName,
        firstName: affiliate.firstName,
        lastName: affiliate.lastName,
        contactPerson: occupationLabel,
        mobile: affiliate.mobileNumber,
        whatsapp: affiliate.whatsappNumber,
        email: affiliate.emailAddress,
        city: affiliate.city,
        state: affiliate.state,
        addressLine1: affiliate.communicationAddress,
        status: affiliate.status,
        bankAccountName: affiliate.bankAccountHolderName,
        bankAccountNumber: affiliate.bankAccountNumber,
        bankIfsc: affiliate.bankIfscNumber,
        bankName: affiliate.bankName,
        createdAt: affiliate.createdAt,
        registrationUrl: liveRegistrationUrl,
        qrPngDataUrl,
        qrSvgString
      },
      metrics: {
        totalStudentsReferred,
        activeLeads,
        totalEarningsExpected,
        totalEarningsWithdrawable,
        totalLeads: totalStudentsReferred,
        todayLeads,
        admissionsCount,
        totalCommission: totalEarningsExpected,
        pendingCommission,
        withdrawableCommission: totalEarningsWithdrawable,
        paidCommission
      },
      activeSettlement,
      recentLeads
    };
  }

  /**
   * Partner Requests Commission Withdrawal
   */
  async requestWithdrawal(partnerId: string, input: RequestWithdrawalInput) {
    const partner = await prisma.affiliate.findUnique({
      where: { id: partnerId }
    });

    if (!partner) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');

    if (partner.status !== AffiliateStatus.ACTIVE) {
      throw new AppError('Only active approved affiliates can request payment withdrawals', 403, 'FORBIDDEN');
    }

    // Check if partner already has a pending or approved settlement awaiting payout
    const activeSettlement = await prisma.settlement.findFirst({
      where: {
        partnerId,
        status: { in: [SettlementStatus.PENDING_APPROVAL, SettlementStatus.APPROVED] }
      }
    });

    if (activeSettlement) {
      throw new AppError(
        `You already have an active withdrawal request (${activeSettlement.settlementCode}) of ₹${Number(activeSettlement.netPaidAmount).toLocaleString('en-IN')} pending admin processing.`,
        400,
        'ACTIVE_REQUEST_EXISTS'
      );
    }

    // Update affiliate bank details if provided
    const bankUpdates: any = {};
    if (input.bankAccountName?.trim()) bankUpdates.bankAccountHolderName = input.bankAccountName.trim();
    if (input.bankAccountNumber?.trim()) bankUpdates.bankAccountNumber = input.bankAccountNumber.trim();
    if (input.bankIfsc?.trim()) bankUpdates.bankIfscNumber = input.bankIfsc.trim().toUpperCase();
    if (input.bankName?.trim()) bankUpdates.bankName = input.bankName.trim();

    if (Object.keys(bankUpdates).length > 0) {
      await prisma.affiliate.update({
        where: { id: partnerId },
        data: bankUpdates
      });
    }

    const currentPartner = await prisma.affiliate.findUnique({ where: { id: partnerId } });
    const hasBank = !!(currentPartner?.bankAccountNumber && currentPartner?.bankIfscNumber);

    if (!hasBank) {
      throw new AppError(
        'Please provide valid bank account details (Account Number & IFSC) for payout transfer.',
        400,
        'BANK_DETAILS_REQUIRED'
      );
    }

    // Auto promote cooling-off commissions
    const fourteenDaysAgo = new Date(Date.now() - STUDENT_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    await prisma.partnerCommission.updateMany({
      where: {
        partnerId,
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

    // Find eligible commissions
    let eligibleCommissions = await prisma.partnerCommission.findMany({
      where: {
        partnerId,
        status: CommissionStatus.ELIGIBLE,
        settlementId: null
      },
      include: {
        admission: { select: { admissionCode: true, admissionDate: true, status: true } }
      }
    });

    if (eligibleCommissions.length === 0) {
      // Check for any pending commissions on verified admissions
      const verifiedPending = await prisma.partnerCommission.findMany({
        where: {
          partnerId,
          status: CommissionStatus.PENDING,
          settlementId: null,
          admission: { status: AdmissionStatus.VERIFIED }
        },
        include: {
          admission: { select: { admissionCode: true, admissionDate: true, status: true } }
        }
      });

      if (verifiedPending.length > 0) {
        // Promote verified admissions to ELIGIBLE on partner withdrawal request
        await prisma.partnerCommission.updateMany({
          where: { id: { in: verifiedPending.map(c => c.id) } },
          data: { status: CommissionStatus.ELIGIBLE }
        });
        eligibleCommissions = verifiedPending;
      } else {
        const anyCommissions = await prisma.partnerCommission.count({
          where: { partnerId, settlementId: null }
        });
        if (anyCommissions === 0) {
          throw new AppError(
            'You currently have ₹0 in eligible commissions to withdraw. Refer students to earn commissions upon confirmed admission.',
            400,
            'NO_ELIGIBLE_COMMISSIONS'
          );
        } else {
          throw new AppError(
            'Your admissions are currently awaiting administrative verification. Commissions become withdrawable once admissions are verified.',
            400,
            'COMMISSIONS_PENDING_VERIFICATION'
          );
        }
      }
    }

    const totalAmount = eligibleCommissions.reduce(
      (sum, c) => sum.add(new Prisma.Decimal(c.commissionAmount)),
      new Prisma.Decimal(0)
    );

    if (totalAmount.lessThanOrEqualTo(0)) {
      throw new AppError('Eligible commission amount must be greater than zero', 400, 'INVALID_AMOUNT');
    }

    const timestamp = Date.now().toString().slice(-4);
    const suffix = Math.floor(100 + Math.random() * 900);
    const settlementCode = `WTH-2026-${timestamp}${suffix}`;

    const earliestDate = eligibleCommissions.reduce((earliest, c) => {
      const d = new Date(c.createdAt);
      return d < earliest ? d : earliest;
    }, new Date());

    const partnerDisplayName = currentPartner ? formatAffiliateBusinessName(currentPartner) : 'Affiliate';

    const settlement = await prisma.$transaction(async (tx) => {
      const newSettlement = await tx.settlement.create({
        data: {
          settlementCode,
          partnerId,
          totalAmount,
          adjustmentAmount: new Prisma.Decimal(0),
          netPaidAmount: totalAmount,
          status: SettlementStatus.PENDING_APPROVAL,
          periodStartDate: earliestDate,
          periodEndDate: new Date(),
          notes: input.notes
            ? `[Affiliate Withdrawal Request] ${input.notes}`
            : `Withdrawal requested by ${partnerDisplayName} via affiliate dashboard.`
        }
      });

      await tx.partnerCommission.updateMany({
        where: { id: { in: eligibleCommissions.map((c) => c.id) } },
        data: {
          settlementId: newSettlement.id,
          status: CommissionStatus.PROCESSING
        }
      });

      // Notify all Admin users
      const admins = await tx.user.findMany({
        where: { role: Role.ADMIN },
        select: { id: true }
      });

      for (const admin of admins) {
        await tx.notification.create({
          data: {
            userId: admin.id,
            title: 'New Payment Withdrawal Request',
            message: `${partnerDisplayName} (${currentPartner?.affiliateCode}) requested a payment withdrawal of ₹${Number(totalAmount).toLocaleString('en-IN')}. Batch ${settlementCode} is awaiting admin approval.`,
            channel: 'IN_APP',
            actionUrl: '/admin/settlements'
          }
        });
      }

      await tx.auditLog.create({
        data: {
          userId: currentPartner?.userId,
          action: 'PAYMENT_WITHDRAWAL_REQUESTED',
          entityType: 'SETTLEMENT',
          entityId: newSettlement.id,
          newValues: {
            settlementCode,
            partnerId,
            partnerCode: currentPartner?.affiliateCode,
            businessName: partnerDisplayName,
            netPaidAmount: totalAmount.toString(),
            commissionsCount: eligibleCommissions.length,
            notes: input.notes
          }
        }
      });

      return newSettlement;
    });

    return settlement;
  }

  /**
   * List Attributed Leads for Partner (Read-Only Statuses)
   */
  async getLeads(partnerId: string, status?: LeadStatus, search?: string, page = 1, limit = 20) {
    const affiliate = await prisma.affiliate.findUnique({ where: { id: partnerId }, select: { status: true } });
    if (!affiliate) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');
    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      throw new AppError('Leads tracker is restricted while your registration is pending approval.', 403, 'ACCOUNT_RESTRICTED');
    }

    const where: any = { partnerId };

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { studentName: { contains: search, mode: 'insensitive' } },
        { leadCode: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        select: {
          id: true,
          leadCode: true,
          studentName: true,
          createdAt: true,
          status: true,
          interestedCourse: { select: { id: true, name: true, feeAmount: true, durationWeeks: true } },
          admission: {
            select: {
              admissionCode: true,
              status: true,
              totalFee: true,
              commission: { select: { commissionAmount: true, status: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      leads,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  /**
   * Commission Ledger for Partner
   */
  async getCommissions(partnerId: string, page = 1, limit = 20) {
    const affiliate = await prisma.affiliate.findUnique({ where: { id: partnerId }, select: { status: true } });
    if (!affiliate) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');
    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      throw new AppError('Commission earnings are restricted while your registration is pending approval.', 403, 'ACCOUNT_RESTRICTED');
    }

    const where = { partnerId };

    const [total, commissions] = await Promise.all([
      prisma.partnerCommission.count({ where }),
      prisma.partnerCommission.findMany({
        where,
        include: {
          admission: {
            select: {
              admissionCode: true,
              admissionDate: true,
              course: { select: { name: true, feeAmount: true } },
              lead: { select: { studentName: true, leadCode: true } }
            }
          },
          settlement: {
            select: {
              settlementCode: true,
              paidAt: true,
              status: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      commissions,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  /**
   * Settlement Payout History for Partner
   */
  async getSettlements(partnerId: string, page = 1, limit = 20) {
    const affiliate = await prisma.affiliate.findUnique({ where: { id: partnerId }, select: { status: true } });
    if (!affiliate) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');
    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      throw new AppError('Settlement history is restricted while your registration is pending approval.', 403, 'ACCOUNT_RESTRICTED');
    }

    const where = { partnerId };

    const [total, settlements] = await Promise.all([
      prisma.settlement.count({ where }),
      prisma.settlement.findMany({
        where,
        include: {
          transactions: true,
          _count: { select: { commissions: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      settlements,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  /**
   * Support Tickets
   */
  async createTicket(partnerId: string, userId: string, data: { subject: string; description: string; priority?: string }) {
    const count = await prisma.supportTicket.count();
    const ticketCode = `TKT-${String(count + 1).padStart(4, '0')}`;

    return prisma.supportTicket.create({
      data: {
        ticketCode,
        partnerId,
        createdById: userId,
        subject: data.subject,
        description: data.description,
        priority: (data.priority as TicketPriority) || TicketPriority.MEDIUM
      }
    });
  }

  /**
   * Public Affiliate Self-Registration from /join or Modal
   */
  async registerPublicPartner(data: PublicPartnerRegisterInput) {
    const firstName = toCapitalCase(data.firstName);
    const lastName = toCapitalCase(data.lastName);
    const fullName = formatFullName(firstName, lastName);
    if (!firstName || !lastName) {
      throw new AppError('First name and last name are required', 400, 'INVALID_NAME');
    }

    const cleanMobileDigits = data.mobileNumber.replace(/\D/g, '').slice(-10);
    const normalizedMobile = `+91${cleanMobileDigits}`;

    const cleanWhatsappDigits = data.whatsappNumber.replace(/\D/g, '').slice(-10);
    const normalizedWhatsapp = `+91${cleanWhatsappDigits}`;
    const emailLower = data.emailAddress.trim().toLowerCase();
    const isTestOtpBypass = env.NODE_ENV !== 'production' && env.ALLOW_TEST_OTP_BYPASS;

    // 0. Verify WhatsApp Number via OTP (unless explicit non-production testing bypass is enabled)
    if (!isTestOtpBypass) {
      const isWhatsappVerified = whatsappOtpService.isPhoneVerified(
        cleanWhatsappDigits,
        data.whatsappVerificationToken
      );
      if (!isWhatsappVerified) {
        throw new AppError(
          'WhatsApp number has not been verified. Please verify your WhatsApp number with the OTP before submitting.',
          400,
          'WHATSAPP_NOT_VERIFIED'
        );
      }

      // 0b. Verify Email Address via OTP
      const isEmailVerified = emailOtpService.isEmailVerified(
        emailLower,
        data.emailVerificationToken
      );
      if (!isEmailVerified) {
        throw new AppError(
          'Email address has not been verified. Please verify your email with the OTP before submitting.',
          400,
          'EMAIL_NOT_VERIFIED'
        );
      }
    } else {
      logger.info(`[Test OTP Bypass] Skipping WhatsApp & Email OTP verification for ${emailLower}`);
    }

    // 1. Check duplicate Mobile Number across users and affiliates
    const [existingPhoneUser, existingPhoneAffiliate] = await Promise.all([
      prisma.user.findFirst({
        where: {
          OR: [
            { mobileNumber: cleanMobileDigits },
            { mobileNumber: normalizedMobile },
            { mobileNumber: { endsWith: cleanMobileDigits } },
            { whatsappNumber: cleanMobileDigits },
            { whatsappNumber: normalizedWhatsapp },
            { emailAddress: cleanMobileDigits }
          ]
        }
      }),
      prisma.affiliate.findFirst({
        where: {
          OR: [
            { mobileNumber: cleanMobileDigits },
            { mobileNumber: normalizedMobile },
            { mobileNumber: { endsWith: cleanMobileDigits } },
            { whatsappNumber: cleanMobileDigits },
            { whatsappNumber: normalizedWhatsapp },
            { whatsappNumber: { endsWith: cleanMobileDigits } }
          ],
          deletedAt: null
        }
      })
    ]);

    if (existingPhoneUser || existingPhoneAffiliate) {
      throw new AppError(
        `An affiliate account with Mobile Number '${cleanMobileDigits}' already exists. Please login to your dashboard or contact support.`,
        409,
        'DUPLICATE_PHONE'
      );
    }

    // 2. Check duplicate WhatsApp Number (when different from Mobile Number)
    if (cleanWhatsappDigits !== cleanMobileDigits) {
      const [existingWhatsappAffiliate, existingWhatsappUser] = await Promise.all([
        prisma.affiliate.findFirst({
          where: {
            OR: [
              { whatsappNumber: cleanWhatsappDigits },
              { whatsappNumber: normalizedWhatsapp },
              { whatsappNumber: { endsWith: cleanWhatsappDigits } },
              { mobileNumber: cleanWhatsappDigits },
              { mobileNumber: normalizedMobile },
              { mobileNumber: { endsWith: cleanWhatsappDigits } }
            ],
            deletedAt: null
          }
        }),
        prisma.user.findFirst({
          where: {
            OR: [
              { mobileNumber: cleanWhatsappDigits },
              { mobileNumber: normalizedWhatsapp },
              { whatsappNumber: cleanWhatsappDigits },
              { whatsappNumber: normalizedWhatsapp }
            ]
          }
        })
      ]);

      if (existingWhatsappAffiliate || existingWhatsappUser) {
        throw new AppError(
          `An affiliate account with WhatsApp Number '${cleanWhatsappDigits}' already exists. Please enter a different WhatsApp number.`,
          409,
          'DUPLICATE_WHATSAPP'
        );
      }
    }

    // 3. Check duplicate Email in User (including soft-deleted) and Affiliate records
    const [existingEmailUser, existingEmailAffiliate] = await Promise.all([
      prisma.user.findFirst({
        where: { emailAddress: { equals: emailLower, mode: 'insensitive' } }
      }),
      prisma.affiliate.findFirst({
        where: { emailAddress: { equals: emailLower, mode: 'insensitive' }, deletedAt: null }
      })
    ]);

    if (existingEmailUser || existingEmailAffiliate) {
      throw new AppError(
        `An affiliate account with Email '${emailLower}' already exists. Please Login or use a different email address.`,
        409,
        'DUPLICATE_EMAIL'
      );
    }

    // 4. Hash chosen password and prepare canonical enum/conditional fields
    const passwordHash = await hashPassword(data.password);
    const prismaOccupation = toPrismaOccupation(data.occupation);
    const cleanLinks = (data.influencerLinks || []).map((l) => l.trim()).filter(Boolean);
    const communicationAddress = data.communicationAddress.trim();
    const city = toCapitalCase(data.city);
    const state = data.state.trim();
    const pincode = data.pincode.trim();
    const bio = data.tellUsMoreAboutYourself?.trim() || null;

    const result = await prisma.$transaction(async (tx) => {
      const affiliateCode = await generateUniqueAffiliateCode(tx);

      // Create user login account (active immediately so affiliate can view restricted pending screen)
      const user = await tx.user.create({
        data: {
          firstName,
          lastName,
          role: Role.AFFILIATE as any,
          gender: data.gender as any,
          age: data.age,
          mobileNumber: normalizedMobile,
          whatsappNumber: normalizedWhatsapp,
          emailAddress: emailLower,
          password: passwordHash,
          occupation: prismaOccupation,
          communicationAddress,
          isActive: true
        }
      });

      const frontendBase = (env.FRONTEND_URL || 'https://affiliate.iotaacademy.in').replace(/\/+$/, '');
      const registrationUrl = `${frontendBase}/register/${affiliateCode}`;

      // Create affiliate record matching exact affiliates columns
      const affiliate = await tx.affiliate.create({
        data: {
          userId: user.id,
          affiliateCode,
          registrationUrl,
          firstName,
          lastName,
          gender: data.gender as any,
          age: data.age,
          mobileNumber: normalizedMobile,
          whatsappNumber: normalizedWhatsapp,
          emailAddress: emailLower,
          communicationAddress,
          city,
          state,
          pincode,
          tellUsMoreAboutYourself: bio,
          occupation: prismaOccupation,
          influencerLinks: prismaOccupation === 'INFLUENCER' && cleanLinks.length > 0 ? cleanLinks : undefined,
          firmName: prismaOccupation === 'OTHER' ? data.firmName?.trim() || null : null,
          specifyOccupation:
            prismaOccupation === 'OTHER'
              ? data.specifyOccupation?.trim() || data.otherOccupationName?.trim() || null
              : null,
          otherOccupationName:
            prismaOccupation === 'OTHER'
              ? data.otherOccupationName?.trim() || data.specifyOccupation?.trim() || null
              : null,
          otherOccupationDescribe: prismaOccupation === 'OTHER' ? data.otherOccupationDescribe?.trim() || null : null,
          status: AffiliateStatus.PENDING_APPROVAL
        }
      });

      return { affiliate, user };
    });

    const tokenPayload: JwtUserPayload = {
      userId: result.user.id,
      email: result.user.emailAddress,
      role: result.user.role as Role,
      partnerId: result.affiliate.id
    };
    const accessToken = generateAccessToken(tokenPayload);
    const sanitizedUser = buildAuthenticatedUser(result.user, result.affiliate);

    // Send WhatsApp & Email using first name only (skip external dispatch for synthetic test addresses in OTP bypass mode)
    const isSyntheticTestEmail =
      isTestOtpBypass && (emailLower.endsWith('@test.iotaacademy.in') || emailLower.endsWith('@example.com'));

    if (!isSyntheticTestEmail) {
      whatsappOtpService.sendAffiliateRegistrationWhatsApp(cleanWhatsappDigits, firstName).catch((waErr) => {
        logger.warn('[WhatsApp Registration Message] Dispatch warning:', waErr);
      });

      emailOtpService.sendAffiliateRegistrationEmail(emailLower, firstName).catch((mailErr) => {
        logger.warn('[Email Registration Message] Dispatch warning:', mailErr);
      });
    }

    // Notify active Admins about the new affiliate application (non-blocking)
    try {
      const admins = await prisma.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true }
      });
      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            title: `New Affiliate Application [${result.affiliate.affiliateCode}]`,
            message: `${fullName} (${data.occupation}, ${state}) submitted an affiliate application. Review pending approval.`,
            actionUrl: '/admin/partners'
          }))
        });
      }
    } catch (notifyErr) {
      console.warn('Could not create admin notification for new affiliate registration:', notifyErr);
    }

    return {
      partnerId: result.affiliate.id,
      partnerCode: result.affiliate.affiliateCode,
      affiliateCode: result.affiliate.affiliateCode,
      businessName: formatAffiliateBusinessName(result.affiliate),
      ownerName: fullName,
      status: result.affiliate.status,
      user: sanitizedUser,
      accessToken,
      message: 'Affiliate application submitted successfully. Your profile is currently pending approval.'
    };
  }
}

export const partnerService = new PartnerService();

