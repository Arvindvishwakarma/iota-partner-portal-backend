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

    const baseUrl = (env.FRONTEND_URL || 'https://iota-partner-portal-frontend.vercel.app').replace(/\/+$/, '');
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

    const baseUrl = (env.FRONTEND_URL || 'https://iota-partner-portal-frontend.vercel.app').replace(/\/+$/, '');
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
    const normalizedMobile = data.phone.startsWith('+91') ? data.phone : `+91${data.phone}`;
    const emailLower = data.email.trim().toLowerCase();

    // 1. Check duplicate email or phone in user or partner records
    const [existingUser, existingPartner] = await Promise.all([
      prisma.user.findFirst({
        where: { OR: [{ email: emailLower }, { phone: normalizedMobile }] }
      }),
      prisma.partner.findFirst({
        where: { OR: [{ email: emailLower }, { mobile: normalizedMobile }] }
      })
    ]);

    if (existingUser || existingPartner) {
      throw new AppError(
        'An affiliate account or application with this mobile number or email already exists. Our team will review your application shortly.',
        400,
        'DUPLICATE_AFFILIATE'
      );
    }

    // 2. Generate a unique provisional Partner Code e.g. PTR-PENDING-KAR-0005
    const stateClean = data.state.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'IND';
    const count = await prisma.partner.count();
    const codeNumber = (count + 1).toString().padStart(4, '0');
    const partnerCode = `PTR-PENDING-${stateClean}-${codeNumber}`;

    // 3. Hash default password for the partner's future portal access
    const defaultPassword = 'Partner@123456';
    const passwordHash = await hashPassword(defaultPassword);

    const businessName = data.businessName?.trim() || data.fullName.trim();
    const categoryEnum = mapCategoryToEnum(data.category);

    const result = await prisma.$transaction(async (tx) => {
      // Create user login account (inactive until admin reviews and approves)
      const user = await tx.user.create({
        data: {
          email: emailLower,
          phone: normalizedMobile,
          fullName: data.fullName.trim(),
          passwordHash,
          role: Role.PARTNER,
          isActive: false
        }
      });

      const registrationUrl = `${env.FRONTEND_URL}/register/${partnerCode}`;

      // Create partner record with PENDING_APPROVAL status
      const partner = await tx.partner.create({
        data: {
          userId: user.id,
          partnerCode,
          businessName,
          category: categoryEnum,
          ownerName: data.fullName.trim(),
          contactPerson: data.fullName.trim(),
          mobile: normalizedMobile,
          whatsapp: normalizedMobile,
          email: emailLower,
          addressLine1: data.address.trim(),
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

