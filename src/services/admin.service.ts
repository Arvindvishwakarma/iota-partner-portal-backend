import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/error.middleware';
import { hashPassword } from '../utils/password';
import { whatsappOtpService } from './whatsapp-otp.service';
import { emailOtpService } from './email-otp.service';
import {
  Role,
  AffiliateStatus,
  PartnerCategory,
  PremisesStatus,
  VisitStatus,
  LeadStatus,
  LeadActivityType,
  AdmissionStatus,
  CommissionStatus,
  Gender
} from '../shared';
import { env } from '../config/environment';
import { generateUniqueAffiliateCode, isLegacyProvisionalCode } from '../utils/affiliate-code';
import {
  formatAffiliateBusinessName,
  formatFullName,
  formatOccupationLabel,
  toPrismaOccupation
} from '../utils/user-display';

function mapStaffRow(u: any) {
  return {
    ...u,
    fullName: formatFullName(u.firstName, u.lastName),
    email: u.emailAddress,
    phone: u.mobileNumber
  };
}

function mapAffiliateRow(a: any) {
  const occupationLabel = formatOccupationLabel(a.occupation);
  return {
    ...a,
    partnerCode: a.affiliateCode,
    businessName: formatAffiliateBusinessName(a),
    ownerName: formatFullName(a.firstName, a.lastName),
    contactPerson: occupationLabel,
    occupationLabel,
    influencerLinks: Array.isArray(a.influencerLinks) ? a.influencerLinks : [],
    mobile: a.mobileNumber,
    whatsapp: a.whatsappNumber,
    email: a.emailAddress,
    addressLine1: a.communicationAddress,
    bankAccountName: a.bankAccountHolderName,
    bankIfsc: a.bankIfscNumber,
    user: a.user ? mapStaffRow(a.user) : undefined
  };
}

export class AdminService {
  /**
   * Aggregate Real-Time Command Center Metrics
   */
  async getDashboardMetrics() {
    const [
      totalLeads,
      newLeadsToday,
      totalPartners,
      activePartners,
      pendingPartners,
      totalAdmissions,
      verifiedAdmissions,
      totalVisits,
      totalCounselors,
      totalSalespersons,
      commissionsAgg,
      recentPendingPartners,
      recentLeads,
      totalContacts,
      newContacts,
      recentContacts
    ] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      prisma.affiliate.count({ where: { deletedAt: null } }),
      prisma.affiliate.count({ where: { status: AffiliateStatus.ACTIVE, deletedAt: null } }),
      prisma.affiliate.count({ where: { status: AffiliateStatus.PENDING_APPROVAL, deletedAt: null } }),
      prisma.admission.count(),
      prisma.admission.count({ where: { status: AdmissionStatus.VERIFIED } }),
      prisma.premisesVisit.count(),
      prisma.user.count({ where: { role: Role.COUNSELLOR, isActive: true, deletedAt: null } }),
      prisma.user.count({ where: { role: Role.SALES, isActive: true, deletedAt: null } }),
      prisma.partnerCommission.groupBy({
        by: ['status'],
        _sum: { commissionAmount: true }
      }),
      prisma.affiliate.findMany({
        where: { status: AffiliateStatus.PENDING_APPROVAL, deletedAt: null },
        select: {
          id: true,
          affiliateCode: true,
          firstName: true,
          lastName: true,
          firmName: true,
          occupation: true,
          city: true,
          state: true,
          mobileNumber: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      }),
      prisma.lead.findMany({
        select: {
          id: true,
          leadCode: true,
          studentName: true,
          city: true,
          status: true,
          createdAt: true,
          partner: { select: { affiliateCode: true, firstName: true, lastName: true, firmName: true, occupation: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      }),
      prisma.contactMessage.count(),
      prisma.contactMessage.count({ where: { status: 'NEW' } }),
      prisma.contactMessage.findMany({
        select: {
          id: true,
          referenceCode: true,
          name: true,
          email: true,
          phone: true,
          category: true,
          subject: true,
          status: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    const totalCommissionEarned = commissionsAgg.reduce((acc, item) => {
      return acc + (Number(item._sum.commissionAmount) || 0);
    }, 0);

    const pendingCommissionAmount = commissionsAgg
      .filter((i) => i.status === CommissionStatus.PENDING || i.status === CommissionStatus.ELIGIBLE)
      .reduce((acc, item) => acc + (Number(item._sum.commissionAmount) || 0), 0);

    const paidCommissionAmount = commissionsAgg
      .filter((i) => i.status === CommissionStatus.PAID)
      .reduce((acc, item) => acc + (Number(item._sum.commissionAmount) || 0), 0);

    const conversionRate = totalLeads > 0 ? ((verifiedAdmissions / totalLeads) * 100).toFixed(1) : '0.0';

    return {
      leads: { total: totalLeads, today: newLeadsToday },
      partners: { total: totalPartners, active: activePartners, pendingApproval: pendingPartners },
      admissions: { total: totalAdmissions, verified: verifiedAdmissions, conversionRate: `${conversionRate}%` },
      visits: { total: totalVisits },
      staff: { counselors: totalCounselors, sales: totalSalespersons },
      financials: {
        totalCommission: totalCommissionEarned,
        pendingCommission: pendingCommissionAmount,
        paidCommission: paidCommissionAmount
      },
      contacts: {
        total: totalContacts,
        new: newContacts
      },
      recentPendingPartners: recentPendingPartners.map((a) => ({
        id: a.id,
        partnerCode: a.affiliateCode,
        businessName: formatAffiliateBusinessName(a),
        ownerName: formatFullName(a.firstName, a.lastName),
        firmName: a.firmName || null,
        contactPerson: formatOccupationLabel(a.occupation),
        city: a.city,
        state: a.state,
        area: a.state,
        mobile: a.mobileNumber,
        createdAt: a.createdAt
      })),
      recentLeads: recentLeads.map((l) => ({
        ...l,
        partner: l.partner
          ? { partnerCode: l.partner.affiliateCode, businessName: formatAffiliateBusinessName(l.partner) }
          : null
      })),
      recentContacts
    };
  }

  // ============================================================================
  // STAFF MANAGEMENT (Counselors & Sales)
  // ============================================================================

  async listStaff(role?: Role, search?: string, isActive?: boolean, page = 1, limit = 20) {
    const where: any = {
      deletedAt: null,
      role: role ? role : { in: [Role.COUNSELLOR, Role.SALES] }
    };

    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { emailAddress: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search } }
      ];
    }

    const [total, staff] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          emailAddress: true,
          mobileNumber: true,
          role: true,
          isActive: true,
          avatarUrl: true,
          lastLoginAt: true,
          createdAt: true,
          _count: {
            select: {
              assignedVisits: true,
              leadAssignments: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      staff: staff.map(mapStaffRow),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async createStaff(data: { fullName: string; email: string; phone: string; password?: string; role: Role }) {
    const emailLower = data.email.toLowerCase().trim();
    const cleanDigits = data.phone.replace(/\D/g, '').slice(-10);
    const normalizedMobile = cleanDigits.length === 10 ? `+91${cleanDigits}` : data.phone.trim();

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ emailAddress: emailLower }, { mobileNumber: normalizedMobile }, { mobileNumber: data.phone.trim() }]
      }
    });

    if (existing) {
      throw new AppError('A user with this email or phone number already exists', 400, 'USER_EXISTS');
    }

    const parts = data.fullName.trim().split(/\s+/);
    const firstName = parts[0] || 'Staff';
    const lastName = parts.slice(1).join(' ') || 'Member';
    const defaultPassword = data.password || 'IOTA@Welcome2026!';
    const passwordHash = await hashPassword(defaultPassword);

    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        emailAddress: emailLower,
        mobileNumber: normalizedMobile,
        whatsappNumber: normalizedMobile,
        password: passwordHash,
        role: data.role as any,
        gender: Gender.Other as any,
        age: 25,
        occupation: toPrismaOccupation('Working Professional'),
        communicationAddress: 'IOTA Academy Office, Indore',
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        emailAddress: true,
        mobileNumber: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });

    return mapStaffRow(user);
  }

  async updateStaffStatus(userId: string, isActive: boolean) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, firstName: true, lastName: true, emailAddress: true, isActive: true }
    });
    return mapStaffRow(updated);
  }

  async updateStaff(userId: string, data: { fullName?: string; email?: string; phone?: string; isActive?: boolean }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    if (data.email && data.email.toLowerCase() !== user.emailAddress.toLowerCase()) {
      const existingEmail = await prisma.user.findFirst({
        where: {
          emailAddress: data.email.toLowerCase().trim(),
          id: { not: userId }
        }
      });
      if (existingEmail) {
        throw new AppError('A user with this email already exists', 400, 'EMAIL_EXISTS');
      }
    }

    if (data.phone && data.phone.trim() !== user.mobileNumber) {
      const existingPhone = await prisma.user.findFirst({
        where: {
          mobileNumber: data.phone.trim(),
          id: { not: userId }
        }
      });
      if (existingPhone) {
        throw new AppError('A user with this phone number already exists', 400, 'PHONE_EXISTS');
      }
    }

    const nameData: { firstName?: string; lastName?: string } = {};
    if (data.fullName?.trim()) {
      const parts = data.fullName.trim().split(/\s+/);
      nameData.firstName = parts[0];
      nameData.lastName = parts.slice(1).join(' ') || user.lastName;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...nameData,
        ...(data.email ? { emailAddress: data.email.toLowerCase().trim() } : {}),
        ...(data.phone ? { mobileNumber: data.phone.trim() } : {}),
        ...(typeof data.isActive === 'boolean' ? { isActive: data.isActive } : {})
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        emailAddress: true,
        mobileNumber: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });

    return mapStaffRow(updated);
  }

  async resetStaffPassword(userId: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    if (!newPassword || newPassword.length < 6) {
      throw new AppError('Password must be at least 6 characters', 400, 'INVALID_PASSWORD');
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash }
    });

    return {
      id: user.id,
      email: user.emailAddress,
      fullName: formatFullName(user.firstName, user.lastName),
      updated: true
    };
  }

  async resetPartnerPassword(partnerId: string, newPassword: string) {
    const partner = await prisma.affiliate.findUnique({ where: { id: partnerId } });
    if (!partner) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');
    if (!partner.userId) throw new AppError('No login user account associated with this affiliate', 400, 'NO_USER');
    return this.resetStaffPassword(partner.userId, newPassword);
  }

  // ============================================================================
  // PARTNER MANAGEMENT
  // ============================================================================

  async listPartners(status?: AffiliateStatus, _category?: PartnerCategory, search?: string, city?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };

    if (status) where.status = status;
    if (city) where.city = { equals: city, mode: 'insensitive' };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { firmName: { contains: search, mode: 'insensitive' } },
        { affiliateCode: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search } },
        { emailAddress: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { state: { contains: search, mode: 'insensitive' } },
        { otherOccupationName: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [total, partners] = await Promise.all([
      prisma.affiliate.count({ where }),
      prisma.affiliate.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, emailAddress: true, mobileNumber: true, isActive: true } },
          _count: {
            select: {
              leads: true,
              commissions: true,
              documents: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      partners: partners.map(mapAffiliateRow),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async getPartnerDetails(partnerId: string) {
    const partner = await prisma.affiliate.findUnique({
      where: { id: partnerId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, emailAddress: true, mobileNumber: true, isActive: true } },
        documents: true,
        _count: { select: { leads: true, commissions: true } }
      }
    });

    if (!partner) throw new AppError('Affiliate profile not found', 404, 'NOT_FOUND');
    return mapAffiliateRow(partner);
  }

  async reviewPartner(partnerId: string, status: AffiliateStatus, rejectionReason?: string) {
    const partner = await prisma.affiliate.findUnique({
      where: { id: partnerId }
    });

    if (!partner) throw new AppError('Affiliate not found', 404, 'NOT_FOUND');

    if (status === AffiliateStatus.ACTIVE) {
      let affiliateCode = partner.affiliateCode;
      if (isLegacyProvisionalCode(affiliateCode)) {
        affiliateCode = await generateUniqueAffiliateCode();
      }

      const frontendBase = (env.FRONTEND_URL || 'https://affiliate.iotaacademy.in').replace(/\/+$/, '');
      const registrationUrl = `${frontendBase}/register/${affiliateCode}`;

      const updated = await prisma.$transaction(async (tx) => {
        if (partner.userId) {
          await tx.user.update({
            where: { id: partner.userId },
            data: { isActive: true }
          });
        }

        return tx.affiliate.update({
          where: { id: partnerId },
          data: {
            status: AffiliateStatus.ACTIVE,
            affiliateCode,
            registrationUrl,
            approvedAt: new Date(),
            rejectionReason: null
          }
        });
      });

      return mapAffiliateRow(updated);
    } else if (status === AffiliateStatus.PROFILE_REJECTED || status === AffiliateStatus.KYC_REJECTED) {
      if (!rejectionReason) {
        throw new AppError('Rejection reason is required', 400, 'MISSING_REJECTION_REASON');
      }

      const updated = await prisma.affiliate.update({
        where: { id: partnerId },
        data: {
          status,
          rejectionReason
        }
      });

      const emailLower = (updated.emailAddress || '').trim().toLowerCase();
      const isSyntheticTestEmail =
        env.NODE_ENV !== 'production' &&
        env.ALLOW_TEST_OTP_BYPASS &&
        (emailLower.endsWith('@test.iotaacademy.in') || emailLower.endsWith('@example.com'));

      if (!isSyntheticTestEmail) {
        whatsappOtpService
          .sendAffiliateRejectionWhatsApp(updated.whatsappNumber || updated.mobileNumber, updated.firstName)
          .catch((waErr) => {
            logger.warn('[WhatsApp Rejection Message] Dispatch warning:', waErr);
          });

        if (emailLower) {
          emailOtpService
            .sendAffiliateRejectionEmail(emailLower, updated.firstName)
            .catch((mailErr) => {
              logger.warn('[Email Rejection Message] Dispatch warning:', mailErr);
            });
        }
      } else {
        logger.info(`[Test Mode] Skipped external WhatsApp/Email rejection dispatch for ${emailLower}`);
      }

      return mapAffiliateRow(updated);
    }

    const updated = await prisma.affiliate.update({
      where: { id: partnerId },
      data: { status }
    });
    return mapAffiliateRow(updated);
  }

  // ============================================================================
  // PREMISES MASTER DIRECTORY & ASSIGNMENTS
  // ============================================================================

  async listPremises(status?: PremisesStatus, category?: PartnerCategory, search?: string, _city?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };

    if (status) where.currentStatus = status;
    if (category) where.category = category;

    if (search) {
      where.OR = [
        { premisesName: { contains: search, mode: 'insensitive' } },
        { fullAddress: { contains: search, mode: 'insensitive' } },
        { contactNumber: { contains: search } }
      ];
    }

    const [total, premises] = await Promise.all([
      prisma.premises.count({ where }),
      prisma.premises.findMany({
        where,
        include: {
          visits: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { salesperson: { select: { id: true, firstName: true, lastName: true, mobileNumber: true, emailAddress: true } } }
          },
          _count: { select: { visits: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      premises: premises.map((p) => ({
        ...p,
        visits: p.visits.map((v) => ({
          ...v,
          salesperson: v.salesperson ? mapStaffRow(v.salesperson) : undefined
        }))
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async createPremises(data: any) {
    return prisma.premises.create({
      data: {
        premisesName: data.premisesName,
        category: data.category,
        customCategory: data.customCategory || null,
        contactNumber: data.contactNumber,
        website: data.website || null,
        googleMapUrl: data.googleMapUrl || null,
        fullAddress: data.fullAddress,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        assignedSalesId: data.assignedSalesId || null,
        currentStatus: data.assignedSalesId ? PremisesStatus.ASSIGNED : PremisesStatus.UNASSIGNED
      }
    });
  }

  async updatePremises(id: string, data: any) {
    const existing = await prisma.premises.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Premises not found', 404, 'NOT_FOUND');
    }

    const updateData: any = {};
    if (data.premisesName !== undefined) updateData.premisesName = data.premisesName;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.customCategory !== undefined) updateData.customCategory = data.customCategory;
    if (data.contactNumber !== undefined) updateData.contactNumber = data.contactNumber;
    if (data.website !== undefined) updateData.website = data.website;
    if (data.googleMapUrl !== undefined) updateData.googleMapUrl = data.googleMapUrl;
    if (data.fullAddress !== undefined) updateData.fullAddress = data.fullAddress;
    if (data.assignedSalesId !== undefined) updateData.assignedSalesId = data.assignedSalesId;

    return prisma.premises.update({
      where: { id },
      data: updateData
    });
  }

  async assignPremisesVisit(premisesId: string, salespersonId: string, scheduledDate?: string) {
    const premises = await prisma.premises.findUnique({ where: { id: premisesId } });
    if (!premises) throw new AppError('Premises not found', 404, 'NOT_FOUND');

    const salesUser = await prisma.user.findFirst({
      where: { id: salespersonId, role: Role.SALES, isActive: true }
    });
    if (!salesUser) throw new AppError('Salesperson not found or inactive', 400, 'INVALID_SALESPERSON');

    // Rule BR-VIS-01: Check for active visit
    const activeVisit = await prisma.premisesVisit.findFirst({
      where: {
        premisesId,
        status: { in: [VisitStatus.ASSIGNED, VisitStatus.IN_PROGRESS] }
      }
    });

    if (activeVisit) {
      // Reassign the existing active visit to the new salesperson
      const reassigned = await prisma.$transaction([
        prisma.premisesVisit.update({
          where: { id: activeVisit.id },
          data: {
            salespersonId,
            scheduledDate: scheduledDate ? new Date(scheduledDate) : activeVisit.scheduledDate
          }
        }),
        prisma.premises.update({
          where: { id: premisesId },
          data: { assignedSalesId: salespersonId, currentStatus: PremisesStatus.ASSIGNED }
        })
      ]);
      return reassigned[0];
    }

    // Otherwise create new active visit
    const result = await prisma.$transaction([
      prisma.premisesVisit.create({
        data: {
          premisesId,
          salespersonId,
          status: VisitStatus.ASSIGNED,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : new Date()
        }
      }),
      prisma.premises.update({
        where: { id: premisesId },
        data: { assignedSalesId: salespersonId, currentStatus: PremisesStatus.ASSIGNED }
      })
    ]);

    return result[0];
  }

  async unassignPremisesVisit(premisesId: string) {
    const premises = await prisma.premises.findUnique({ where: { id: premisesId } });
    if (!premises) throw new AppError('Premises not found', 404, 'NOT_FOUND');

    await prisma.$transaction([
      prisma.premisesVisit.updateMany({
        where: {
          premisesId,
          status: { in: [VisitStatus.ASSIGNED, VisitStatus.IN_PROGRESS] }
        },
        data: {
          status: VisitStatus.CANCELLED,
          remarks: 'Unassigned by administrator'
        }
      }),
      prisma.premises.update({
        where: { id: premisesId },
        data: {
          assignedSalesId: null,
          currentStatus: PremisesStatus.UNASSIGNED
        }
      })
    ]);

    return { id: premisesId, currentStatus: PremisesStatus.UNASSIGNED, assignedSalesId: null };
  }

  async bulkAssignVisits(premisesIds: string[], salespersonId: string, scheduledDate?: string) {
    const results = [];
    for (const premisesId of premisesIds) {
      const visit = await this.assignPremisesVisit(premisesId, salespersonId, scheduledDate);
      results.push(visit);
    }
    return { assignedCount: results.length, visits: results };
  }

  async listAllVisits(filters: any = {}, page = 1, limit = 25) {
    const where: any = {};

    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status;
    }
    if (filters.salespersonId && filters.salespersonId !== 'ALL') {
      where.salespersonId = filters.salespersonId;
    }
    if (filters.premisesId) {
      where.premisesId = filters.premisesId;
    }

    if (filters.search) {
      const s = filters.search;
      where.OR = [
        { premises: { premisesName: { contains: s, mode: 'insensitive' } } },
        { premises: { fullAddress: { contains: s, mode: 'insensitive' } } },
        { premises: { contactNumber: { contains: s } } },
        { salesperson: { firstName: { contains: s, mode: 'insensitive' } } },
        { salesperson: { lastName: { contains: s, mode: 'insensitive' } } },
        { remarks: { contains: s, mode: 'insensitive' } }
      ];
    }

    const [total, visits, statsAgg] = await Promise.all([
      prisma.premisesVisit.count({ where }),
      prisma.premisesVisit.findMany({
        where,
        include: {
          premises: {
            select: {
              id: true,
              premisesName: true,
              category: true,
              customCategory: true,
              contactNumber: true,
              website: true,
              googleMapUrl: true,
              fullAddress: true,
              latitude: true,
              longitude: true
            }
          },
          salesperson: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              emailAddress: true,
              mobileNumber: true
            }
          }
        },
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      Promise.all([
        prisma.premisesVisit.count(),
        prisma.premisesVisit.count({ where: { status: VisitStatus.ASSIGNED } }),
        prisma.premisesVisit.count({ where: { status: VisitStatus.IN_PROGRESS } }),
        prisma.premisesVisit.count({
          where: {
            status: {
              in: [
                VisitStatus.COMPLETED,
                VisitStatus.INTERESTED,
                VisitStatus.NOT_INTERESTED,
                VisitStatus.PARTNER_ONBOARDED
              ]
            }
          }
        }),
        prisma.premisesVisit.count({
          where: {
            distanceFromTarget: { lte: 500 }
          }
        })
      ])
    ]);

    const [totalAll, assignedCount, inProgressCount, completedCount, geofenceCompliantCount] = statsAgg;

    return {
      visits: visits.map((v) => ({
        ...v,
        salesperson: v.salesperson ? mapStaffRow(v.salesperson) : undefined
      })),
      stats: {
        total: totalAll,
        assigned: assignedCount,
        inProgress: inProgressCount,
        completed: completedCount,
        geofenceCompliant: geofenceCompliantCount
      },
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  // ============================================================================
  // GLOBAL LEAD MONITORING & REASSIGNMENT
  // ============================================================================

  async listAllLeads(filters: any = {}, page = 1, limit = 20) {
    const where: any = {};

    if (filters.status) where.status = filters.status;
    if (filters.partnerId) where.partnerId = filters.partnerId;
    if (filters.courseId) where.interestedCourseId = filters.courseId;
    if (filters.counsellorId) where.currentCounsellorId = filters.counsellorId;

    if (filters.search) {
      where.OR = [
        { studentName: { contains: filters.search, mode: 'insensitive' } },
        { leadCode: { contains: filters.search, mode: 'insensitive' } },
        { mobile: { contains: filters.search } },
        { city: { contains: filters.search, mode: 'insensitive' } }
      ];
    }

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        include: {
          partner: { select: { id: true, affiliateCode: true, firstName: true, lastName: true, firmName: true, occupation: true } },
          interestedCourse: { select: { id: true, name: true, feeAmount: true } },
          assignments: {
            where: { isCurrent: true },
            include: { counsellor: { select: { id: true, firstName: true, lastName: true } } },
            take: 1
          },
          activities: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } }
          },
          admission: { select: { id: true, admissionCode: true, status: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      leads: leads.map((l) => ({
        ...l,
        partner: l.partner ? { id: l.partner.id, partnerCode: l.partner.affiliateCode, businessName: formatAffiliateBusinessName(l.partner) } : null,
        assignments: l.assignments.map((a) => ({
          ...a,
          counsellor: a.counsellor ? { id: a.counsellor.id, fullName: formatFullName(a.counsellor.firstName, a.counsellor.lastName) } : undefined
        })),
        activities: l.activities.map((act) => ({
          ...act,
          user: act.user ? { id: act.user.id, fullName: formatFullName(act.user.firstName, act.user.lastName), role: act.user.role } : undefined
        }))
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async reassignLead(leadId: string, newCounsellorId: string, adminUserId: string, remarks?: string) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new AppError('Lead not found', 404, 'NOT_FOUND');

    const counsellor = await prisma.user.findFirst({
      where: { id: newCounsellorId, role: Role.COUNSELLOR, isActive: true }
    });
    if (!counsellor) throw new AppError('Target counselor not found or inactive', 400, 'INVALID_COUNSELLOR');

    return prisma.$transaction(async (tx) => {
      // 1. Deactivate existing current assignment
      await tx.leadAssignment.updateMany({
        where: { leadId, isCurrent: true },
        data: { isCurrent: false, unassignedAt: new Date() }
      });

      // 2. Create new active assignment
      await tx.leadAssignment.create({
        data: {
          leadId,
          counsellorId: newCounsellorId,
          assignedByUserId: adminUserId,
          isCurrent: true
        }
      });

      // 3. Update lead record
      const updatedLead = await tx.lead.update({
        where: { id: leadId },
        data: {
          currentCounsellorId: newCounsellorId,
          lastActivityAt: new Date(),
          lastActivityById: adminUserId
        }
      });

      // 4. Log immutable lead activity
      await tx.leadActivity.create({
        data: {
          leadId,
          userId: adminUserId,
          activityType: LeadActivityType.COUNSELLOR_REASSIGNED,
          previousStatus: lead.status,
          newStatus: lead.status,
          remarks: remarks || `Reassigned to Counselor ${formatFullName(counsellor.firstName, counsellor.lastName)} by Administrator`
        }
      });

      return updatedLead;
    });
  }

  // ============================================================================
  // CONTACT INQUIRIES MANAGEMENT
  // ============================================================================

  async listContactMessages(query: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    status?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ContactMessageWhereInput = {};

    if (query.status && query.status !== 'ALL') {
      where.status = query.status as any;
    }

    if (query.category && query.category !== 'ALL') {
      where.category = query.category;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { referenceCode: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { subject: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [total, items, newCount, inProgressCount, resolvedCount, totalAll] = await Promise.all([
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.contactMessage.count({ where: { status: 'NEW' } }),
      prisma.contactMessage.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.contactMessage.count({ where: { status: 'RESOLVED' } }),
      prisma.contactMessage.count()
    ]);

    return {
      contacts: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      counts: {
        total: totalAll,
        new: newCount,
        inProgress: inProgressCount,
        resolved: resolvedCount
      }
    };
  }

  async getContactMessage(id: string) {
    const item = await prisma.contactMessage.findUnique({
      where: { id }
    });
    if (!item) {
      throw new AppError('Contact message not found', 404, 'NOT_FOUND');
    }
    return item;
  }

  async updateContactMessageStatus(id: string, data: { status?: string; adminNotes?: string | null }) {
    const existing = await prisma.contactMessage.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Contact message not found', 404, 'NOT_FOUND');
    }

    const updateData: Prisma.ContactMessageUpdateInput = {};
    if (data.status) {
      updateData.status = data.status as any;
      if (data.status === 'RESOLVED' && !existing.respondedAt) {
        updateData.respondedAt = new Date();
      }
    }
    if (data.adminNotes !== undefined) {
      updateData.adminNotes = data.adminNotes;
    }

    return prisma.contactMessage.update({
      where: { id },
      data: updateData
    });
  }

  async deleteContactMessage(id: string) {
    const existing = await prisma.contactMessage.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Contact message not found', 404, 'NOT_FOUND');
    }
    await prisma.contactMessage.delete({ where: { id } });
    return { success: true };
  }
}

export const adminService = new AdminService();

