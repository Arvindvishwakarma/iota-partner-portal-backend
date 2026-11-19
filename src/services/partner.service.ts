import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import { generateQrPngDataUrl, generateQrSvgString } from '../utils/qrcode';
import {
  AdmissionStatus,
  CommissionStatus,
  LeadStatus,
  SettlementStatus,
  TicketPriority,
  PartnerStatus,
  Role,
  STUDENT_REFUND_WINDOW_DAYS
} from '../shared';
import { env } from '../config/environment';
import { hashPassword } from '../utils/password';
import {
  PublicPartnerRegisterInput,
  mapCategoryToEnum,
  isIndividualOccupation
} from '../validators/public-partner.validator';
import { generateUniqueAffiliateCode } from '../utils/affiliate-code';
import { RequestWithdrawalInput } from '../validators/settlement.validator';
import { whatsappOtpService } from './whatsapp-otp.service';

export class PartnerService {
  /**
   * Fetch Partner Dashboard Overview Metrics
   */
  async getDashboard(partnerId: string) {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        partnerCode: true,
        businessName: true,
        ownerName: true,
        status: true,
        city: true,
        registrationUrl: true,
        bankAccountName: true,
        bankAccountNumber: true,
        bankIfsc: true,
        bankName: true,
        upiId: true
      }
    });

    if (!partner) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');

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

    const [
      totalLeads,
      todayLeads,
      admissionsCount,
      commissionsAgg,
      recentLeads,
      activeSettlement
    ] = await Promise.all([
      prisma.lead.count({ where: { partnerId } }),
      prisma.lead.count({
        where: {
          partnerId,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }
      }),
      prisma.lead.count({
        where: { partnerId, status: LeadStatus.ADMISSION_CONFIRMED }
      }),
      prisma.partnerCommission.groupBy({
        by: ['status'],
        where: { partnerId },
        _sum: { commissionAmount: true }
      }),
      prisma.lead.findMany({
        where: { partnerId },
        select: {
          id: true,
          leadCode: true,
          studentName: true,
          createdAt: true,
          status: true,
          interestedCourse: { select: { name: true } },
          admission: {
            select: {
              status: true,
              commission: { select: { commissionAmount: true, status: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
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
      })
    ]);

    const totalCommission = commissionsAgg.reduce(
      (acc, item) => acc + (Number(item._sum.commissionAmount) || 0),
      0
    );

    const pendingCommission = commissionsAgg
      .filter((i) => i.status === CommissionStatus.PENDING || i.status === CommissionStatus.ELIGIBLE)
      .reduce((acc, item) => acc + (Number(item._sum.commissionAmount) || 0), 0);

    const withdrawableCommission = commissionsAgg
      .filter((i) => i.status === CommissionStatus.ELIGIBLE)
      .reduce((acc, item) => acc + (Number(item._sum.commissionAmount) || 0), 0);

    const processingCommission = commissionsAgg
      .filter((i) => i.status === CommissionStatus.PROCESSING)
      .reduce((acc, item) => acc + (Number(item._sum.commissionAmount) || 0), 0);

    const paidCommission = commissionsAgg
      .filter((i) => i.status === CommissionStatus.PAID)
      .reduce((acc, item) => acc + (Number(item._sum.commissionAmount) || 0), 0);

    const baseUrl = (env.FRONTEND_URL || 'https://affiliate.iotaacademy.in').replace(/\/+$/, '');
    const liveRegistrationUrl = `${baseUrl}/register/${partner.partnerCode}`;

    return {
      partner: {
        ...partner,
        registrationUrl: liveRegistrationUrl
      },
      metrics: {
        totalLeads,
        todayLeads,
        admissionsCount,
        totalCommission,
        pendingCommission,
        withdrawableCommission,
        processingCommission,
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
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId }
    });

    if (!partner) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');

    if (partner.status !== PartnerStatus.ACTIVE) {
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

    // Update partner bank or UPI details if provided
    const bankUpdates: any = {};
    if (input.bankAccountName?.trim()) bankUpdates.bankAccountName = input.bankAccountName.trim();
    if (input.bankAccountNumber?.trim()) bankUpdates.bankAccountNumber = input.bankAccountNumber.trim();
    if (input.bankIfsc?.trim()) bankUpdates.bankIfsc = input.bankIfsc.trim().toUpperCase();
    if (input.bankName?.trim()) bankUpdates.bankName = input.bankName.trim();
    if (input.upiId?.trim()) bankUpdates.upiId = input.upiId.trim().toLowerCase();

    if (Object.keys(bankUpdates).length > 0) {
      await prisma.partner.update({
        where: { id: partnerId },
        data: bankUpdates
      });
    }

    const currentPartner = await prisma.partner.findUnique({ where: { id: partnerId } });
    const hasBank = !!(currentPartner?.bankAccountNumber && currentPartner?.bankIfsc);
    const hasUpi = !!currentPartner?.upiId;

    if (!hasBank && !hasUpi) {
      throw new AppError(
        'Please provide bank account details (Account Number & IFSC) or a valid UPI ID for payout transfer.',
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
            ? `[Partner Withdrawal Request] ${input.notes}`
            : `Withdrawal requested by ${currentPartner?.businessName} via partner dashboard.`
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
            message: `${currentPartner?.businessName} (${currentPartner?.partnerCode}) requested a payment withdrawal of ₹${Number(totalAmount).toLocaleString('en-IN')}. Batch ${settlementCode} is awaiting admin approval.`,
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
            partnerCode: currentPartner?.partnerCode,
            businessName: currentPartner?.businessName,
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
   * Generate Live High-Resolution QR Assets & Poster URLs
   */
  async getQrAssets(partnerId: string) {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        partnerCode: true,
        businessName: true,
        city: true,
        registrationUrl: true
      }
    });

    if (!partner) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');

    const baseUrl = (env.FRONTEND_URL || 'https://affiliate.iotaacademy.in').replace(/\/+$/, '');
    const registrationUrl = `${baseUrl}/register/${partner.partnerCode}`;

    // Generate live PNG data URL & SVG string
    const [pngDataUrl, svgString] = await Promise.all([
      generateQrPngDataUrl(registrationUrl),
      generateQrSvgString(registrationUrl)
    ]);

    return {
      partnerCode: partner.partnerCode,
      businessName: partner.businessName,
      city: partner.city,
      registrationUrl,
      pngDataUrl,
      svgString
    };
  }

  /**
   * List Attributed Leads for Partner (Read-Only Statuses)
   */
  async getLeads(partnerId: string, status?: LeadStatus, search?: string, page = 1, limit = 20) {
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
          interestedCourse: { select: { id: true, name: true, durationWeeks: true } },
          admission: {
            select: {
              admissionCode: true,
              status: true,
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
   * Public Partner Self-Registration from Landing Page
   */
  async registerPublicPartner(data: PublicPartnerRegisterInput) {
    const fullName = (data.fullName || `${data.firstName || ''} ${data.lastName || ''}`).trim();
    if (!fullName) {
      throw new AppError('Full name is required', 400, 'INVALID_NAME');
    }

    const cleanMobileDigits = data.phone.replace(/\D/g, '').slice(-10);
    const normalizedMobile = `+91${cleanMobileDigits}`;

    const rawWhatsapp = (data.whatsapp && data.whatsapp.trim()) || data.phone;
    const cleanWhatsappDigits = rawWhatsapp.replace(/\D/g, '').slice(-10);
    const normalizedWhatsapp = `+91${cleanWhatsappDigits}`;

    // 0. Verify WhatsApp Number via OTP
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

    const hasProvidedEmail = Boolean(data.email && data.email.trim());
    const emailLower = hasProvidedEmail ? data.email!.trim().toLowerCase() : '';

    // If no email entered, the username is the 10-digit phone number without +91
    const username = hasProvidedEmail ? emailLower : cleanMobileDigits;
    const userEmail = username;
    const partnerEmail = username;

    // 1. Check duplicate Phone Number in User (including soft-deleted to avoid DB unique constraint 500) and Partner records (mobile + whatsapp)
    const [existingPhoneUser, existingPhonePartner] = await Promise.all([
      prisma.user.findFirst({
        where: {
          OR: [
            { phone: cleanMobileDigits },
            { phone: normalizedMobile },
            { phone: { endsWith: cleanMobileDigits } },
            { email: cleanMobileDigits }
          ]
        }
      }),
      prisma.partner.findFirst({
        where: {
          OR: [
            { mobile: cleanMobileDigits },
            { mobile: normalizedMobile },
            { mobile: { endsWith: cleanMobileDigits } },
            { whatsapp: cleanMobileDigits },
            { whatsapp: normalizedWhatsapp },
            { whatsapp: { endsWith: cleanMobileDigits } }
          ],
          deletedAt: null
        }
      })
    ]);

    if (existingPhoneUser || existingPhonePartner) {
      throw new AppError(
        `An affiliate account with Mobile Number '${cleanMobileDigits}' already exists. Please login to your dashboard or contact support.`,
        409,
        'DUPLICATE_PHONE'
      );
    }

    // 2. Check duplicate WhatsApp Number (only needed when different from Mobile Number)
    if (cleanWhatsappDigits !== cleanMobileDigits) {
      const [existingWhatsappPartner, existingWhatsappUser] = await Promise.all([
        prisma.partner.findFirst({
          where: {
            OR: [
              { whatsapp: cleanWhatsappDigits },
              { whatsapp: normalizedWhatsapp },
              { whatsapp: { endsWith: cleanWhatsappDigits } },
              { mobile: cleanWhatsappDigits },
              { mobile: normalizedWhatsapp },
              { mobile: { endsWith: cleanWhatsappDigits } }
            ],
            deletedAt: null
          }
        }),
        prisma.user.findFirst({
          where: {
            OR: [
              { phone: cleanWhatsappDigits },
              { phone: normalizedWhatsapp },
              { phone: { endsWith: cleanWhatsappDigits } },
              { email: cleanWhatsappDigits }
            ]
          }
        })
      ]);

      if (existingWhatsappPartner || existingWhatsappUser) {
        throw new AppError(
          `An affiliate account with WhatsApp Number '${cleanWhatsappDigits}' already exists. Please enter a different WhatsApp number.`,
          409,
          'DUPLICATE_WHATSAPP'
        );
      }
    }

    // 3. Check duplicate Email in User (including soft-deleted) and Partner records (if email was provided)
    if (hasProvidedEmail) {
      const [existingEmailUser, existingEmailPartner] = await Promise.all([
        prisma.user.findFirst({
          where: { email: { equals: emailLower, mode: 'insensitive' } }
        }),
        prisma.partner.findFirst({
          where: { email: { equals: emailLower, mode: 'insensitive' }, deletedAt: null }
        })
      ]);

      if (existingEmailUser || existingEmailPartner) {
        throw new AppError(
          `An affiliate account with Email '${emailLower}' already exists. Please sign in or use a different email address.`,
          409,
          'DUPLICATE_EMAIL'
        );
      }
    }

    // 4. Hash default password for the affiliate's future portal access
    const defaultPassword = 'Partner@123456';
    const passwordHash = await hashPassword(defaultPassword);

    const chosenCategory = data.occupation?.trim() || data.category?.trim() || 'Student';
    const isIndividual = isIndividualOccupation(chosenCategory);
    const businessName = isIndividual
      ? `${fullName} (${chosenCategory})`
      : (data.businessName?.trim() || fullName);
    const categoryEnum = mapCategoryToEnum(chosenCategory);

    const displayCategory = data.otherBusiness?.trim()
      ? `Other: ${data.otherBusiness.trim()}`
      : chosenCategory;

    // Build rich profile metadata for internal ops/admin review
    const profileParts = [
      `Occupation: ${displayCategory}`,
      data.gender?.trim() ? `Gender: ${data.gender.trim()}` : null,
      data.age ? `Age: ${data.age}` : null
    ].filter(Boolean);
    const contactPersonInfo = profileParts.join(' | ');

    const notesParts = [
      data.socialLink?.trim() ? `Social: ${data.socialLink.trim()}` : null,
      data.notes?.trim() ? `Notes: ${data.notes.trim()}` : null
    ].filter(Boolean);
    const addressLine2 = notesParts.length ? notesParts.join(' | ') : null;

    const addressLine1 = (data.address && data.address.trim())
      ? data.address.trim()
      : (isIndividual ? `Individual / Personal (${data.state.trim()})` : 'Not Provided');

    const result = await prisma.$transaction(async (tx) => {
      // Generate a unique 6-character alphanumeric affiliate code (e.g. "7K9M2X")
      const partnerCode = await generateUniqueAffiliateCode(tx);

      // Create user login account (inactive until admin reviews and approves)
      const user = await tx.user.create({
        data: {
          email: userEmail,
          phone: cleanMobileDigits,
          fullName,
          passwordHash,
          role: Role.PARTNER,
          isActive: false
        }
      });

      const frontendBase = (env.FRONTEND_URL || 'https://affiliate.iotaacademy.in').replace(/\/+$/, '');
      const registrationUrl = `${frontendBase}/register/${partnerCode}`;

      // Create affiliate record with PENDING_APPROVAL status
      const partner = await tx.partner.create({
        data: {
          userId: user.id,
          partnerCode,
          businessName,
          category: categoryEnum,
          ownerName: fullName,
          contactPerson: contactPersonInfo, // Stores human-readable occupation, gender, age
          mobile: cleanMobileDigits,
          whatsapp: cleanWhatsappDigits,
          email: partnerEmail,
          addressLine1,
          addressLine2, // Stores social profile links and custom notes
          city: (data.city && data.city.trim()) ? data.city.trim() : data.state.trim(),
          area: '',
          pincode: data.pincode.trim(),
          registrationUrl,
          status: PartnerStatus.PENDING_APPROVAL
        }
      });

      return { partner, user };
    });

    // Notify all active Admins about the new affiliate application (non-blocking)
    try {
      const admins = await prisma.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true }
      });
      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            title: `New Affiliate Application [${result.partner.partnerCode}]`,
            message: `${fullName} (${displayCategory}, ${data.state.trim()}) applied to join the IOTA Affiliate Program.`,
            actionUrl: '/admin/partners?status=PENDING_APPROVAL'
          }))
        });
      }
    } catch (notifyErr) {
      console.warn('Could not create admin notification for new affiliate application:', notifyErr);
    }

    return {
      partnerId: result.partner.id,
      partnerCode: result.partner.partnerCode,
      affiliateCode: result.partner.partnerCode,
      businessName: result.partner.businessName,
      ownerName: result.partner.ownerName,
      status: result.partner.status,
      message: 'Affiliate application submitted successfully. Pending admin review.'
    };
  }
}

export const partnerService = new PartnerService();

