import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import { generateQrPngDataUrl, generateQrSvgString } from '../utils/qrcode';
import { CommissionStatus, LeadStatus, SettlementStatus, TicketPriority } from '../shared';
import { env } from '../config/environment';

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

    return {
      partner,
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

    const registrationUrl = partner.registrationUrl || `${env.FRONTEND_URL}/register/${partner.partnerCode}`;

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
}

export const partnerService = new PartnerService();

