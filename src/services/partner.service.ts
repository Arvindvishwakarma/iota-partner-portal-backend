import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import { generateQrPngDataUrl, generateQrSvgString } from '../utils/qrcode';
import {
  CommissionStatus,
  LeadStatus,
  SettlementStatus,
  TicketPriority,
  PartnerStatus,
  Role
} from '../shared';
import { env } from '../config/environment';
import { hashPassword } from '../utils/password';
import {
  PublicPartnerRegisterInput,
  mapCategoryToEnum
} from '../validators/public-partner.validator';

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
        status: true,
        city: true,
        registrationUrl: true
      }
    });

    if (!partner) throw new AppError('Partner not found', 404, 'NOT_FOUND');

    const [
      totalLeads,
      todayLeads,
      admissionsCount,
      commissionsAgg,
      recentLeads
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
      })
    ]);

    const totalCommission = commissionsAgg.reduce(
      (acc, item) => acc + (Number(item._sum.commissionAmount) || 0),
      0
    );

    const pendingCommission = commissionsAgg
      .filter((i) => i.status === CommissionStatus.PENDING || i.status === CommissionStatus.ELIGIBLE)
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
        paidCommission
      },
      recentLeads
    };
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

    if (!partner) throw new AppError('Partner not found', 404, 'NOT_FOUND');

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

    const hasProvidedEmail = Boolean(data.email && data.email.trim());
    const emailLower = hasProvidedEmail ? data.email!.trim().toLowerCase() : '';

    // If no email entered, the username is the 10-digit phone number without +91
    const username = hasProvidedEmail ? emailLower : cleanMobileDigits;
    const userEmail = username;
    const partnerEmail = username;

    // 1. Check duplicate Phone Number in User or Partner records
    const [existingPhoneUser, existingPhonePartner] = await Promise.all([
      prisma.user.findFirst({
        where: {
          OR: [
            { phone: cleanMobileDigits },
            { phone: normalizedMobile },
            { phone: { endsWith: cleanMobileDigits } },
            { email: cleanMobileDigits }
          ],
          deletedAt: null
        }
      }),
      prisma.partner.findFirst({
        where: {
          OR: [
            { mobile: cleanMobileDigits },
            { mobile: normalizedMobile },
            { mobile: { endsWith: cleanMobileDigits } }
          ],
          deletedAt: null
        }
      })
    ]);

    if (existingPhoneUser || existingPhonePartner) {
      throw new AppError(
        `An affiliate account with Phone Number '${cleanMobileDigits}' already exists. Please login to your dashboard or contact support.`,
        409,
        'DUPLICATE_PHONE'
      );
    }

    // 2. Check duplicate WhatsApp Number in Partner and User records
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
          ],
          deletedAt: null
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

    // 3. Check duplicate Email in User and Partner records (if email was provided)
    if (hasProvidedEmail) {
      const [existingEmailUser, existingEmailPartner] = await Promise.all([
        prisma.user.findFirst({
          where: { email: { equals: emailLower, mode: 'insensitive' }, deletedAt: null }
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

    // 2. Generate a unique provisional Partner Code e.g. PTR-PENDING-KAR-0005
    const stateClean = data.state.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'IND';
    const count = await prisma.partner.count();
    const codeNumber = (count + 1).toString().padStart(4, '0');
    const partnerCode = `PTR-PENDING-${stateClean}-${codeNumber}`;

    // 3. Hash default password for the partner's future portal access
    const defaultPassword = 'Partner@123456';
    const passwordHash = await hashPassword(defaultPassword);

    const isIndividual = data.category === 'Individual (No Business)' || data.category.toLowerCase().includes('individual');
    const businessName = isIndividual ? `${fullName} (Individual)` : (data.businessName?.trim() || fullName);
    const categoryEnum = mapCategoryToEnum(data.category);

    const displayCategory = data.otherBusiness?.trim()
      ? `Other: ${data.otherBusiness.trim()}`
      : data.category.trim();

    const addressLine1 = (data.address && data.address.trim())
      ? data.address.trim()
      : (isIndividual ? `Individual / Personal (${data.state.trim()})` : data.state.trim());

    const result = await prisma.$transaction(async (tx) => {
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

      const frontendBase = env.FRONTEND_URL || 'https://affiliate.iotaacademy.in';
      const registrationUrl = `${frontendBase}/register/${partnerCode}`;

      // Create partner record with PENDING_APPROVAL status
      const partner = await tx.partner.create({
        data: {
          userId: user.id,
          partnerCode,
          businessName,
          category: categoryEnum,
          ownerName: fullName,
          contactPerson: displayCategory, // Stores human-readable category & custom business
          mobile: cleanMobileDigits,
          whatsapp: cleanWhatsappDigits,
          email: partnerEmail,
          addressLine1,
          addressLine2: data.notes?.trim() || null,
          city: data.state.trim(),
          area: data.state.trim(),
          pincode: data.pincode.trim(),
          registrationUrl,
          status: PartnerStatus.PENDING_APPROVAL
        }
      });

      return { partner, user };
    });

    return {
      partnerId: result.partner.id,
      partnerCode: result.partner.partnerCode,
      businessName: result.partner.businessName,
      ownerName: result.partner.ownerName,
      status: result.partner.status,
      message: 'Affiliate application submitted successfully. Pending admin review.'
    };
  }
}

export const partnerService = new PartnerService();

