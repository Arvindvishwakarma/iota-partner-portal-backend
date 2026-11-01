import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import { hashPassword } from '../utils/password';
import {
  Role,
  PartnerStatus,
  PartnerCategory,
  PremisesStatus,
  VisitStatus,
  LeadStatus,
  LeadActivityType,
  AdmissionStatus,
  CommissionStatus
} from '../shared';
import { env } from '../config/environment';

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
      recentLeads
    ] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      prisma.partner.count({ where: { deletedAt: null } }),
      prisma.partner.count({ where: { status: PartnerStatus.ACTIVE, deletedAt: null } }),
      prisma.partner.count({ where: { status: PartnerStatus.PENDING_APPROVAL, deletedAt: null } }),
      prisma.admission.count(),
      prisma.admission.count({ where: { status: AdmissionStatus.VERIFIED } }),
      prisma.premisesVisit.count(),
      prisma.user.count({ where: { role: Role.COUNSELLOR, isActive: true, deletedAt: null } }),
      prisma.user.count({ where: { role: Role.SALES, isActive: true, deletedAt: null } }),
      prisma.partnerCommission.groupBy({
        by: ['status'],
        _sum: { commissionAmount: true }
      }),
      prisma.partner.findMany({
        where: { status: PartnerStatus.PENDING_APPROVAL, deletedAt: null },
        select: {
          id: true,
          partnerCode: true,
          businessName: true,
          ownerName: true,
          category: true,
          city: true,
          area: true,
          mobile: true,
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
          partner: { select: { businessName: true, partnerCode: true } }
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
      recentPendingPartners,
      recentLeads
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
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } }
      ];
    }

    const [total, staff] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
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
      staff,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async createStaff(data: { fullName: string; email: string; phone: string; password?: string; role: Role }) {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: data.email.toLowerCase() }, { phone: data.phone }]
      }
    });

    if (existing) {
      throw new AppError('A user with this email or phone number already exists', 400, 'USER_EXISTS');
    }

    const defaultPassword = data.password || 'IOTA@Welcome2026!';
    const passwordHash = await hashPassword(defaultPassword);

    const user = await prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email.toLowerCase(),
        phone: data.phone,
        passwordHash,
        role: data.role,
        isActive: true
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });

    return user;
  }

  async updateStaffStatus(userId: string, isActive: boolean) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    return prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, fullName: true, email: true, isActive: true }
    });
  }

  async updateStaff(userId: string, data: { fullName?: string; email?: string; phone?: string; isActive?: boolean }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    if (data.email && data.email.toLowerCase() !== user.email.toLowerCase()) {
      const existingEmail = await prisma.user.findFirst({
        where: {
          email: data.email.toLowerCase().trim(),
          id: { not: userId }
        }
      });
      if (existingEmail) {
        throw new AppError('A user with this email already exists', 400, 'EMAIL_EXISTS');
      }
    }

    if (data.phone && data.phone.trim() !== user.phone) {
      const existingPhone = await prisma.user.findFirst({
        where: {
          phone: data.phone.trim(),
          id: { not: userId }
        }
      });
      if (existingPhone) {
        throw new AppError('A user with this phone number already exists', 400, 'PHONE_EXISTS');
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.fullName ? { fullName: data.fullName.trim() } : {}),
        ...(data.email ? { email: data.email.toLowerCase().trim() } : {}),
        ...(data.phone ? { phone: data.phone.trim() } : {}),
        ...(typeof data.isActive === 'boolean' ? { isActive: data.isActive } : {})
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });

    return updated;
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
      data: { passwordHash }
    });

    return { id: user.id, email: user.email, fullName: user.fullName, updated: true };
  }

  async resetPartnerPassword(partnerId: string, newPassword: string) {
    const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new AppError('Partner not found', 404, 'NOT_FOUND');
    if (!partner.userId) throw new AppError('No login user account associated with this partner', 400, 'NO_USER');
    return this.resetStaffPassword(partner.userId, newPassword);
  }

  // ============================================================================
  // PARTNER MANAGEMENT
  // ============================================================================

  async listPartners(status?: PartnerStatus, category?: PartnerCategory, search?: string, city?: string, page = 1, limit = 20) {
    // 0. Auto-sync any onboarded premises that do not have a partner record yet
    try {
      const unlinkedOnboardedPremises = await prisma.premises.findMany({
        where: {
          currentStatus: PremisesStatus.PARTNER_ONBOARDED,
          partner: null
        },
        include: { visits: { orderBy: { createdAt: 'desc' }, take: 1 } }
      });

      for (const p of unlinkedOnboardedPremises) {
        const rawPhone = p.contactNumber.replace(/\D/g, '');
        const normalizedMobile = p.contactNumber.startsWith('+91')
          ? p.contactNumber
          : `+91${rawPhone}`;
        const email = `${rawPhone || p.id.slice(0, 8)}@partner.iotaacademy.in`;

        let user = await prisma.user.findFirst({
          where: { OR: [{ email }, { phone: normalizedMobile }] }
        });

        if (!user) {
          const defaultPasswordHash = await hashPassword('Partner@123456');
          user = await prisma.user.create({
            data: {
              email,
              phone: normalizedMobile,
              fullName: p.premisesName,
              passwordHash: defaultPasswordHash,
              role: Role.PARTNER,
              isActive: false
            }
          });
        }

        const partnerCode = `PTR-PENDING-${p.id.substring(0, 6).toUpperCase()}`;
        const registrationUrl = `${env.FRONTEND_URL}/register/${partnerCode}`;
        const salespersonId = p.visits?.[0]?.salespersonId || p.assignedSalesId || null;

        await prisma.partner.create({
          data: {
            userId: user.id,
            premisesId: p.id,
            partnerCode,
            businessName: p.premisesName,
            category: p.category,
            ownerName: p.premisesName,
            contactPerson: p.premisesName,
            mobile: normalizedMobile,
            email,
            addressLine1: p.fullAddress,
            addressLine2: null,
            city: 'General',
            area: 'General',
            pincode: '560001',
            latitude: p.latitude,
            longitude: p.longitude,
            registrationUrl,
            status: PartnerStatus.PENDING_APPROVAL,
            onboardedByUserId: salespersonId
          }
        });
      }
    } catch (syncErr) {
      console.warn('Failed to auto-sync unlinked onboarded premises to partners:', syncErr);
    }

    const where: any = { deletedAt: null };

    if (status) where.status = status;
    if (category) where.category = category;
    if (city) where.city = { equals: city, mode: 'insensitive' };

    if (search) {
      where.OR = [
        { businessName: { contains: search, mode: 'insensitive' } },
        { partnerCode: { contains: search, mode: 'insensitive' } },
        { ownerName: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [total, partners] = await Promise.all([
      prisma.partner.count({ where }),
      prisma.partner.findMany({
        where,
        include: {
          user: { select: { fullName: true, email: true, isActive: true } },
          premises: { select: { id: true, premisesName: true, fullAddress: true } },
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
      partners,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async getPartnerDetails(partnerId: string) {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true } },
        premises: true,
        documents: true,
        _count: { select: { leads: true, commissions: true } }
      }
    });

    if (!partner) throw new AppError('Partner profile not found', 404, 'NOT_FOUND');
    return partner;
  }

  async reviewPartner(partnerId: string, status: PartnerStatus, rejectionReason?: string) {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      include: { premises: true }
    });

    if (!partner) throw new AppError('Partner not found', 404, 'NOT_FOUND');

    if (status === PartnerStatus.ACTIVE) {
      // Deterministic unique partner code if not yet assigned
      let partnerCode = partner.partnerCode;
      if (!partnerCode || partnerCode.startsWith('TEMP') || partnerCode.startsWith('PTR-PENDING')) {
        const cityPrefix = (partner.city || 'BLR').substring(0, 3).toUpperCase();
        const count = await prisma.partner.count({ where: { status: PartnerStatus.ACTIVE } });
        const seq = String(count + 1).padStart(4, '0');
        partnerCode = `PTR-${cityPrefix}-${seq}`;
      }

      const registrationUrl = `${env.FRONTEND_URL}/register/${partnerCode}`;

      const updated = await prisma.$transaction(async (tx) => {
        // Activate user login account
        if (partner.userId) {
          await tx.user.update({
            where: { id: partner.userId },
            data: { isActive: true }
          });
        }

        const p = await tx.partner.update({
          where: { id: partnerId },
          data: {
            status: PartnerStatus.ACTIVE,
            partnerCode,
            registrationUrl,
            approvedAt: new Date(),
            rejectionReason: null
          }
        });

        // If converted from premises, mark premises as PARTNER_ONBOARDED
        if (partner.premisesId) {
          await tx.premises.update({
            where: { id: partner.premisesId },
            data: { currentStatus: PremisesStatus.PARTNER_ONBOARDED }
          });
        }

        return p;
      });

      return updated;
    } else if (status === PartnerStatus.REJECTED) {
      if (!rejectionReason) {
        throw new AppError('Rejection reason is required', 400, 'MISSING_REJECTION_REASON');
      }

      return prisma.partner.update({
        where: { id: partnerId },
        data: {
          status: PartnerStatus.REJECTED,
          rejectionReason
        }
      });
    }

    return prisma.partner.update({
      where: { id: partnerId },
      data: { status }
    });
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
          partner: { select: { id: true, partnerCode: true, status: true } },
          visits: {
            where: { status: { in: [VisitStatus.ASSIGNED, VisitStatus.IN_PROGRESS] } },
            take: 1,
            include: { salesperson: { select: { id: true, fullName: true, phone: true } } }
          },
          _count: { select: { visits: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      premises,
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
        { premises: { area: { contains: s, mode: 'insensitive' } } },
        { premises: { city: { contains: s, mode: 'insensitive' } } },
        { salesperson: { fullName: { contains: s, mode: 'insensitive' } } }
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
              fullName: true,
              email: true,
              phone: true
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
      visits,
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
          partner: { select: { id: true, partnerCode: true, businessName: true, category: true } },
          interestedCourse: { select: { id: true, name: true, feeAmount: true } },
          assignments: {
            where: { isCurrent: true },
            include: { counsellor: { select: { id: true, fullName: true } } },
            take: 1
          },
          activities: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, fullName: true, role: true } } }
          },
          admission: { select: { id: true, admissionCode: true, status: true } }
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
          remarks: remarks || `Reassigned to Counselor ${counsellor.fullName} by Administrator`
        }
      });

      return updatedLead;
    });
  }
}

export const adminService = new AdminService();

