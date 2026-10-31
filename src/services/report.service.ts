import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { LeadStatus, AdmissionStatus, SettlementStatus, Role } from '../shared';
import { ExportQueryInput, ReportFilterInput } from '../validators/report.validator';

export class ReportService {
  /**
   * Get High-Level BI Overview Analytics & Time Series
   */
  async getOverviewAnalytics(filter: ReportFilterInput) {
    const whereLead: any = {};
    if (filter.startDate) whereLead.createdAt = { gte: new Date(filter.startDate) };
    if (filter.endDate) {
      whereLead.createdAt = { ...whereLead.createdAt, lte: new Date(filter.endDate) };
    }
    if (filter.city) whereLead.city = { equals: filter.city, mode: 'insensitive' };
    if (filter.partnerId) whereLead.partnerId = filter.partnerId;
    if (filter.counsellorId) whereLead.currentCounsellorId = filter.counsellorId;

    const [
      totalLeads,
      convertedLeads,
      lostLeads,
      inProgressLeads,
      totalPartners,
      activePartners,
      admissionsSum,
      settlementsPaidSum,
      recentLeads
    ] = await Promise.all([
      prisma.lead.count({ where: whereLead }),
      prisma.lead.count({ where: { ...whereLead, status: LeadStatus.ADMISSION_CONFIRMED } }),
      prisma.lead.count({ where: { ...whereLead, status: LeadStatus.LOST } }),
      prisma.lead.count({
        where: {
          ...whereLead,
          status: {
            in: [
              LeadStatus.NEW,
              LeadStatus.CONTACTED,
              LeadStatus.CONNECTED,
              LeadStatus.INTERESTED,
              LeadStatus.OFFICE_VISIT_SCHEDULED,
              LeadStatus.OFFICE_VISIT_COMPLETED,
              LeadStatus.DEMO_ATTENDED
            ]
          }
        }
      }),
      prisma.partner.count(),
      prisma.partner.count({ where: { status: 'ACTIVE' } }),
      prisma.admission.aggregate({
        where: { status: { in: [AdmissionStatus.VERIFIED, AdmissionStatus.PENDING_VERIFICATION] } },
        _sum: { paidFee: true }
      }),
      prisma.settlement.aggregate({
        where: { status: SettlementStatus.PAID },
        _sum: { netPaidAmount: true }
      }),
      prisma.lead.findMany({
        where: whereLead,
        select: { createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 500
      })
    ]);

    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0.0';

    // Aggregate 14-day trend from recentLeads
    const dayMap = new Map<string, { date: string; leads: number; admissions: number }>();
    const now = Date.now();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, { date: key, leads: 0, admissions: 0 });
    }

    for (const lead of recentLeads) {
      const key = lead.createdAt.toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry) {
        entry.leads += 1;
        if (lead.status === LeadStatus.ADMISSION_CONFIRMED) {
          entry.admissions += 1;
        }
      }
    }

    const timeSeriesTrends = Array.from(dayMap.values());

    return {
      kpis: {
        totalLeads,
        convertedLeads,
        inProgressLeads,
        lostLeads,
        conversionRate: parseFloat(conversionRate),
        totalPartners,
        activePartners,
        grossFeeRevenue: admissionsSum._sum.paidFee || 0,
        settlementsDisbursed: settlementsPaidSum._sum.netPaidAmount || 0
      },
      timeSeriesTrends
    };
  }

  /**
   * Partner ROI & Attribution Ranking
   */
  async getPartnerRoiReport(limit = 10) {
    const partners = await prisma.partner.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        partnerCode: true,
        businessName: true,
        category: true,
        city: true,
        area: true,
        _count: {
          select: {
            leads: true,
            commissions: true
          }
        },
        commissions: {
          select: {
            commissionAmount: true,
            status: true
          }
        }
      },
      take: 50
    });

    const rows = partners.map((p) => {
      const totalLeads = p._count.leads;
      const totalCommissions = p._count.commissions;
      const totalEarned = p.commissions
        .filter((c) => c.status === 'PAID')
        .reduce((sum, c) => sum + Number(c.commissionAmount), 0);
      const pendingEarned = p.commissions
        .filter((c) => c.status === 'PENDING' || c.status === 'ELIGIBLE' || c.status === 'PROCESSING')
        .reduce((sum, c) => sum + Number(c.commissionAmount), 0);
      const conversionRate = totalLeads > 0 ? ((totalCommissions / totalLeads) * 100).toFixed(1) : '0.0';

      return {
        id: p.id,
        partnerCode: p.partnerCode,
        businessName: p.businessName,
        category: p.category,
        location: `${p.area}, ${p.city}`,
        totalLeads,
        admissionsConverted: totalCommissions,
        conversionRate: parseFloat(conversionRate),
        totalEarned,
        pendingEarned
      };
    });

    rows.sort((a, b) => b.totalLeads - a.totalLeads);
    return rows.slice(0, limit);
  }

  /**
   * Academic Counselor Turnaround & Pipeline Metrics
   */
  async getCounsellorPerformanceReport() {
    const counsellors = await prisma.user.findMany({
      where: { role: Role.COUNSELLOR, isActive: true },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        _count: {
          select: {
            leadAssignments: true,
            leadActivities: true
          }
        },
        leadAssignments: {
          select: {
            isCurrent: true,
            lead: {
              select: {
                status: true,
                createdAt: true,
                updatedAt: true
              }
            }
          }
        }
      }
    });

    return counsellors.map((c) => {
      const assigned = c._count.leadAssignments;
      const converted = c.leadAssignments.filter(
        (la) => la.isCurrent && la.lead.status === LeadStatus.ADMISSION_CONFIRMED
      ).length;
      const lost = c.leadAssignments.filter(
        (la) => la.isCurrent && la.lead.status === LeadStatus.LOST
      ).length;
      const inProgress = Math.max(0, assigned - converted - lost);
      const activities = c._count.leadActivities;
      const conversionRate = assigned > 0 ? ((converted / assigned) * 100).toFixed(1) : '0.0';

      return {
        id: c.id,
        name: c.fullName,
        email: c.email,
        phone: c.phone,
        totalAssigned: assigned,
        admitted: converted,
        inProgress,
        lost,
        activitiesLogged: activities,
        conversionRate: parseFloat(conversionRate)
      };
    });
  }

  /**
   * Field Sales Canvassing & Geofence Performance
   */
  async getSalespersonPerformanceReport() {
    const salesTeam = await prisma.user.findMany({
      where: { role: Role.SALES, isActive: true },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        _count: {
          select: {
            assignedVisits: true
          }
        },
        assignedVisits: {
          select: {
            distanceFromTarget: true,
            visitedAt: true
          }
        }
      }
    });

    return salesTeam.map((s) => {
      const totalVisits = s._count.assignedVisits;
      const validGeoVisits = s.assignedVisits.filter(
        (v) => v.distanceFromTarget !== null && v.distanceFromTarget <= 500
      ).length;
      const geofenceCompliance =
        totalVisits > 0 ? Math.round((validGeoVisits / totalVisits) * 100) : 100;

      return {
        id: s.id,
        name: s.fullName,
        email: s.email,
        phone: s.phone,
        totalVisits,
        geofenceCompliantVisits: validGeoVisits,
        complianceRate: geofenceCompliance
      };
    });
  }

  /**
   * High-Performance Server-Side Streaming CSV Export for Leads
   */
  async streamLeadsCsv(res: Response, filter: ExportQueryInput, maskPii = false) {
    const filename = `iota_leads_export_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    // Write CSV Header
    res.write(
      [
        'Lead Code',
        'Student Name',
        'Mobile Number',
        'City',
        'Attributed Partner Code',
        'Attributed Business Name',
        'Assigned Counselor',
        'Status',
        'Created Date',
        'Attribution Expiry'
      ].join(',') + '\r\n'
    );

    const where: any = {};
    if (filter.startDate) where.createdAt = { gte: new Date(filter.startDate) };
    if (filter.endDate) {
      where.createdAt = { ...where.createdAt, lte: new Date(filter.endDate) };
    }
    if (filter.city) where.city = { equals: filter.city, mode: 'insensitive' };
    if (filter.status) where.status = filter.status;

    // Stream records in batches of 200
    const batchSize = 200;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const leads = await prisma.lead.findMany({
        where,
        include: {
          partner: { select: { partnerCode: true, businessName: true } },
          assignments: {
            where: { isCurrent: true },
            include: { counsellor: { select: { fullName: true } } },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: batchSize
      });

      if (leads.length === 0) {
        hasMore = false;
        break;
      }

      for (const lead of leads) {
        let phoneDisplay = lead.mobile;
        if (maskPii && phoneDisplay.length >= 10) {
          phoneDisplay = phoneDisplay.slice(0, 5) + '*****' + phoneDisplay.slice(-2);
        }

        const escapeCsv = (val?: string | null) => {
          if (!val) return '""';
          return `"${val.replace(/"/g, '""')}"`;
        };

        const counselorName = lead.assignments?.[0]?.counsellor?.fullName || 'Unassigned';
        const attributionExpiry = new Date(lead.createdAt.getTime() + 60 * 24 * 60 * 60 * 1000);

        const line = [
          escapeCsv(lead.leadCode),
          escapeCsv(lead.studentName),
          escapeCsv(phoneDisplay),
          escapeCsv(lead.city || 'N/A'),
          escapeCsv(lead.partner?.partnerCode || 'DIRECT'),
          escapeCsv(lead.partner?.businessName || 'Direct Intake'),
          escapeCsv(counselorName),
          escapeCsv(lead.status),
          escapeCsv(lead.createdAt.toISOString().slice(0, 10)),
          escapeCsv(attributionExpiry.toISOString().slice(0, 10))
        ].join(',');

        res.write(line + '\r\n');
      }

      skip += batchSize;
      if (leads.length < batchSize) {
        hasMore = false;
      }
    }

    res.end();
  }

  /**
   * High-Performance Server-Side Streaming CSV Export for Settlements
   */
  async streamSettlementsCsv(res: Response, filter: ExportQueryInput) {
    const filename = `iota_settlements_export_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    res.write(
      [
        'Settlement Code',
        'Partner Code',
        'Business Name',
        'Period Start',
        'Period End',
        'Total Gross Amount (INR)',
        'Clawback Adjustment (INR)',
        'Net Paid Amount (INR)',
        'Status',
        'Bank Account',
        'IFSC Code',
        'Payment Mode',
        'Bank UTR Reference',
        'Disbursed Date'
      ].join(',') + '\r\n'
    );

    const where: any = {};
    if (filter.status) where.status = filter.status;

    const settlements = await prisma.settlement.findMany({
      where,
      include: {
        partner: true,
        transactions: { orderBy: { transactedAt: 'desc' } }
      },
      orderBy: { createdAt: 'desc' }
    });

    for (const s of settlements) {
      const escapeCsv = (val?: string | null) => {
        if (!val) return '""';
        return `"${val.replace(/"/g, '""')}"`;
      };

      const primaryTx = s.transactions?.[0];

      const line = [
        escapeCsv(s.settlementCode),
        escapeCsv(s.partner.partnerCode),
        escapeCsv(s.partner.businessName),
        escapeCsv(s.periodStartDate.toISOString().slice(0, 10)),
        escapeCsv(s.periodEndDate.toISOString().slice(0, 10)),
        s.totalAmount.toString(),
        s.adjustmentAmount.toString(),
        s.netPaidAmount.toString(),
        escapeCsv(s.status),
        escapeCsv(s.partner.bankAccountNumber ? `••••${s.partner.bankAccountNumber.slice(-4)}` : 'N/A'),
        escapeCsv(s.partner.bankIfsc || 'N/A'),
        escapeCsv(primaryTx?.paymentMode || 'N/A'),
        escapeCsv(primaryTx?.transactionRef || 'N/A'),
        escapeCsv(s.paidAt ? s.paidAt.toISOString().slice(0, 10) : 'UNPAID')
      ].join(',');

      res.write(line + '\r\n');
    }

    res.end();
  }
}

export const reportService = new ReportService();
