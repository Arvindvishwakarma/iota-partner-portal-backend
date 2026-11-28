import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import {
  LeadStatus,
  LeadActivityType,
  AdmissionStatus,
  CommissionStatus,
  VALID_LEAD_TRANSITIONS,
  Role
} from '../shared';
import {
  deriveMainStatusFromLegacy,
  findPipelineStage
} from '../shared/pipeline-statuses';
import {
  ConvertAdmissionInput,
  LogActivityInput,
  UpdateLeadStatusInput
} from '../validators/counsellor.validator';
import { formatAffiliateBusinessName, formatFullName } from '../utils/user-display';

function mapLeadPartner(p: any) {
  if (!p) return null;
  return {
    id: p.id,
    partnerCode: p.affiliateCode,
    businessName: formatAffiliateBusinessName(p),
    ownerName: formatFullName(p.firstName, p.lastName),
    city: p.city,
    mobile: p.mobileNumber
  };
}

export class CounsellorService {
  /**
   * Fetch Counselor Overview & KPI Metrics
   */
  async getDashboard(counsellorId: string, role: string) {
    const isCounselor = role === Role.COUNSELLOR;
    const baseWhere = isCounselor ? { currentCounsellorId: counsellorId } : {};

    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

    const [
      totalAssigned,
      newLeads,
      inProgressLeads,
      admissionsConfirmed,
      todayActivities,
      scheduledFollowupsToday,
      overdueFollowups,
      priorityFollowups
    ] = await Promise.all([
      prisma.lead.count({ where: baseWhere }),
      prisma.lead.count({ where: { ...baseWhere, status: LeadStatus.NEW } }),
      prisma.lead.count({
        where: {
          ...baseWhere,
          status: {
            in: [
              LeadStatus.CONTACTED,
              LeadStatus.CONNECTED,
              LeadStatus.INTERESTED,
              LeadStatus.FOLLOW_UP_REQUIRED,
              LeadStatus.OFFICE_VISIT_SCHEDULED,
              LeadStatus.DEMO_ATTENDED
            ]
          }
        }
      }),
      prisma.lead.count({
        where: { ...baseWhere, status: LeadStatus.ADMISSION_CONFIRMED }
      }),
      prisma.leadActivity.count({
        where: {
          userId: counsellorId,
          createdAt: { gte: todayStart }
        }
      }),
      prisma.leadActivity.count({
        where: {
          userId: counsellorId,
          scheduledFor: { gte: todayStart, lte: todayEnd }
        }
      }),
      prisma.leadActivity.count({
        where: {
          userId: counsellorId,
          scheduledFor: { lt: todayStart }
        }
      }),
      // Fetch upcoming / today's priority leads with scheduled follow-ups
      prisma.lead.findMany({
        where: {
          ...baseWhere,
          status: { notIn: [LeadStatus.ADMISSION_CONFIRMED, LeadStatus.LOST, LeadStatus.INVALID_CONTACT] }
        },
        select: {
          id: true,
          leadCode: true,
          studentName: true,
          mobile: true,
          whatsapp: true,
          status: true,
          currentMainStatus: true,
          currentSubStatus: true,
          city: true,
          createdAt: true,
          interestedCourse: { select: { id: true, name: true } },
          partner: { select: { id: true, affiliateCode: true, firstName: true, lastName: true, firmName: true, occupation: true } },
          activities: {
            where: { scheduledFor: { not: null } },
            orderBy: { scheduledFor: 'asc' },
            take: 1,
            select: { id: true, activityType: true, remarks: true, scheduledFor: true }
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: 8
      })
    ]);

    return {
      metrics: {
        totalAssigned,
        newLeads,
        inProgressLeads,
        admissionsConfirmed,
        todayActivities,
        scheduledFollowupsToday,
        overdueFollowups
      },
      priorityFollowups: priorityFollowups.map((l) => ({
        ...l,
        partner: mapLeadPartner(l.partner)
      }))
    };
  }

  /**
   * Get Assigned Leads (Paginated, with Unmasked Contacts)
   */
  async getLeads(
    counsellorId: string,
    role: string,
    filter: { status?: LeadStatus; search?: string; page?: number; limit?: number }
  ) {
    const isCounselor = role === Role.COUNSELLOR;
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = isCounselor ? { currentCounsellorId: counsellorId } : {};

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { studentName: { contains: q, mode: 'insensitive' } },
        { leadCode: { contains: q, mode: 'insensitive' } },
        { mobile: { contains: q } },
        { city: { contains: q, mode: 'insensitive' } }
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
          mobile: true, // UNMASKED for assigned counselor
          whatsapp: true,
          city: true,
          currentEducation: true,
          preferredContactTime: true,
          preferredLearningMode: true,
          status: true,
          currentMainStatus: true,
          currentSubStatus: true,
          lastStatusRemark: true,
          lastStatusUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
          lastActivityAt: true,
          partner: {
            select: {
              id: true,
              affiliateCode: true,
              firstName: true,
              lastName: true,
              firmName: true,
              occupation: true
            }
          },
          interestedCourse: {
            select: {
              id: true,
              name: true,
              feeAmount: true,
              durationWeeks: true
            }
          },
          admission: {
            select: {
              id: true,
              admissionCode: true,
              totalFee: true,
              paidFee: true,
              status: true
            }
          },
          activities: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              activityType: true,
              remarks: true,
              scheduledFor: true,
              createdAt: true
            }
          }
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    return {
      leads: leads.map((l) => ({ ...l, partner: mapLeadPartner(l.partner) })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get Single Lead Profile with Full Activity Log
   */
  async getLeadById(counsellorId: string, leadId: string, role: string) {
    const isCounselor = role === Role.COUNSELLOR;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        partner: {
          select: {
            id: true,
            affiliateCode: true,
            firstName: true,
            lastName: true,
            firmName: true,
            occupation: true,
            city: true,
            mobileNumber: true
          }
        },
        interestedCourse: true,
        admission: {
          include: {
            payments: { orderBy: { paymentDate: 'desc' } },
            commission: {
              select: {
                id: true,
                commissionAmount: true,
                status: true
              }
            }
          }
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true
              }
            }
          }
        },
        duplicateSubmissions: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!lead) {
      throw new AppError('Lead not found', 404, 'NOT_FOUND');
    }

    if (isCounselor && lead.currentCounsellorId !== counsellorId) {
      throw new AppError(
        'Access denied: You are only permitted to manage leads assigned directly to your portfolio',
        403,
        'FORBIDDEN'
      );
    }

    let lastStatusUpdatedByName: string | null = null;
    if (lead.lastStatusUpdatedById) {
      const updater = await prisma.user.findUnique({
        where: { id: lead.lastStatusUpdatedById },
        select: { firstName: true, lastName: true }
      });
      if (updater) {
        lastStatusUpdatedByName = formatFullName(updater.firstName, updater.lastName);
      }
    }

    const mappedActivities = lead.activities.map((a) => ({
      ...a,
      user: a.user ? { id: a.user.id, fullName: formatFullName(a.user.firstName, a.user.lastName), role: a.user.role } : undefined
    }));

    const statusHistory = mappedActivities.filter(
      (a) =>
        a.activityType === LeadActivityType.STATUS_CHANGE ||
        a.activityType === LeadActivityType.ADMISSION_CLOSED ||
        a.activityType === LeadActivityType.SYSTEM_ATTRIBUTED
    );

    const interactionHistory = mappedActivities.filter(
      (a) =>
        a.activityType !== LeadActivityType.STATUS_CHANGE &&
        a.activityType !== LeadActivityType.ADMISSION_CLOSED &&
        a.activityType !== LeadActivityType.SYSTEM_ATTRIBUTED &&
        a.activityType !== LeadActivityType.COUNSELLOR_ASSIGNED &&
        a.activityType !== LeadActivityType.COUNSELLOR_REASSIGNED
    );

    const latestStatusActivity = mappedActivities.find((a) => a.activityType === LeadActivityType.STATUS_CHANGE);
    const nextScheduledActivity = mappedActivities.find((a) => Boolean(a.scheduledFor));

    const canonicalStoredStage = findPipelineStage(lead.currentMainStatus);
    const resolvedMainStatus =
      canonicalStoredStage?.mainStatus ||
      deriveMainStatusFromLegacy(lead.status, lead.admission?.status);

    return {
      ...lead,
      currentMainStatus: resolvedMainStatus,
      currentSubStatus: lead.currentSubStatus || null,
      lastStatusRemark: lead.lastStatusRemark ?? latestStatusActivity?.remarks ?? null,
      lastStatusUpdatedAt: lead.lastStatusUpdatedAt ?? latestStatusActivity?.createdAt ?? null,
      lastStatusUpdatedByName: lastStatusUpdatedByName ?? latestStatusActivity?.user?.fullName ?? null,
      nextFollowUpAt: nextScheduledActivity?.scheduledFor ?? null,
      partner: mapLeadPartner(lead.partner),
      activities: mappedActivities,
      statusHistory,
      interactionHistory
    };
  }

  /**
   * Log Outreach Activity (Call, WhatsApp, Note, Demo Scheduled)
   */
  async logActivity(counsellorId: string, leadId: string, role: string, data: LogActivityInput) {
    // Validate lead access
    const lead = await this.getLeadById(counsellorId, leadId, role);

    const activity = await prisma.$transaction(async (tx) => {
      const created = await tx.leadActivity.create({
        data: {
          leadId,
          userId: counsellorId,
          activityType: data.activityType,
          remarks: data.remarks,
          scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
          previousStatus: lead.status,
          newStatus: lead.status
        },
        include: {
          user: { select: { firstName: true, lastName: true, role: true } }
        }
      });

      await tx.lead.update({
        where: { id: leadId },
        data: {
          lastActivityAt: new Date(),
          lastActivityById: counsellorId
        }
      });

      return created;
    });

    return activity;
  }

  /**
   * Update Lead Status across the 8 lifecycle stages:
   * 1) Pending (By Default)
   * 2) Counselling
   * 3) Demo in Progress
   * 4) Demo Done
   * 5) Registration Done
   * 6) Joined
   * 7) Cancelled
   * 8) Dropout
   */
  async updateLeadStatus(counsellorId: string, leadId: string, role: string, data: UpdateLeadStatusInput) {
    const lead = await this.getLeadById(counsellorId, leadId, role);
    const currentStatus = lead.status;
    const previousMainStatus =
      lead.currentMainStatus || deriveMainStatusFromLegacy(lead.status, lead.admission?.status);
    const previousSubStatus = lead.currentSubStatus || null;

    const inputStatus = (data.status || '').trim();
    const matchedStage = findPipelineStage(inputStatus);

    // Map input to LeadStatus and optional AdmissionStatus
    let targetLeadStatus: LeadStatus = LeadStatus.NEW;
    let targetAdmissionStatus: AdmissionStatus | null = null;
    let newMainStatus = matchedStage ? matchedStage.mainStatus : deriveMainStatusFromLegacy(inputStatus, null);
    let newSubStatus = data.subStatus?.trim() || null;

    if (matchedStage) {
      targetLeadStatus = matchedStage.dbLeadStatus;
      targetAdmissionStatus = matchedStage.dbAdmissionStatus || null;
      if (matchedStage.subStatuses.length === 0) {
        newSubStatus = null;
      }
    } else {
      const norm = inputStatus.toUpperCase().replace(/\s+/g, '_');
      if (norm === 'JOINED') {
        targetLeadStatus = LeadStatus.ADMISSION_CONFIRMED;
        targetAdmissionStatus = AdmissionStatus.VERIFIED;
        newMainStatus = 'Joined';
      } else if (norm === 'CANCELLED' || norm === 'CANCELED' || norm === 'INVALID_CONTACT') {
        targetLeadStatus = LeadStatus.INVALID_CONTACT;
        targetAdmissionStatus = AdmissionStatus.CANCELLED;
        newMainStatus = 'Cancelled';
      } else if (norm === 'DROPOUT' || norm === 'DROPPED' || norm === 'LOST' || norm === 'NOT_INTERESTED') {
        targetLeadStatus = LeadStatus.LOST;
        targetAdmissionStatus = AdmissionStatus.REJECTED;
        newMainStatus = 'Closed';
      } else if (norm === 'REGISTRATION_DONE' || norm === 'ADMISSION_CONFIRMED') {
        targetLeadStatus = LeadStatus.ADMISSION_CONFIRMED;
        targetAdmissionStatus = AdmissionStatus.PENDING_VERIFICATION;
        newMainStatus = 'Registration Done';
      } else if (norm === 'DEMO_DONE' || norm === 'DEMO_ATTENDED' || norm === 'OFFICE_VISIT_COMPLETED') {
        targetLeadStatus = LeadStatus.DEMO_ATTENDED;
        newMainStatus = 'Demo Done';
      } else if (
        norm === 'DEMO_IN_PROGRESS' ||
        norm === 'OFFICE_VISIT_SCHEDULED' ||
        norm === 'DEMO_SCHEDULED' ||
        norm === 'VISIT_SCHEDULED'
      ) {
        targetLeadStatus = LeadStatus.OFFICE_VISIT_SCHEDULED;
        newMainStatus = 'Demo In Progress';
      } else if (norm === 'INTERESTED') {
        targetLeadStatus = LeadStatus.INTERESTED;
        newMainStatus = 'Registration In Progress';
      } else if (
        norm === 'COUNSELLING' ||
        norm === 'COUNSELING' ||
        norm === 'CONNECTED' ||
        norm === 'FOLLOW_UP_REQUIRED'
      ) {
        targetLeadStatus = LeadStatus.CONNECTED;
        newMainStatus = 'Connected';
      } else if (norm === 'CONTACT_IN_PROGRESS' || norm === 'CONTACTED') {
        targetLeadStatus = LeadStatus.CONTACTED;
        newMainStatus = 'Contact In Progress';
      } else if (norm === 'PENDING' || norm === 'NEW') {
        targetLeadStatus = LeadStatus.NEW;
        newMainStatus = 'Not Connected Yet';
      } else if (Object.values(LeadStatus).includes(inputStatus as LeadStatus)) {
        targetLeadStatus = inputStatus as LeadStatus;
      }
    }

    // Resolve scheduled date/time from conditional demo or callback fields if not explicitly set
    let resolvedScheduledFor: Date | null = data.scheduledFor ? new Date(data.scheduledFor) : null;
    if (!resolvedScheduledFor && data.demoDate && data.demoTime) {
      const parsed = new Date(`${data.demoDate}T${data.demoTime}`);
      if (!isNaN(parsed.getTime())) resolvedScheduledFor = parsed;
    } else if (!resolvedScheduledFor && data.callbackDate && data.callbackTime) {
      const parsed = new Date(`${data.callbackDate}T${data.callbackTime}`);
      if (!isNaN(parsed.getTime())) resolvedScheduledFor = parsed;
    }

    // Build clean metadata for conditional fields
    const metadata: Record<string, any> = {};
    if (data.demoMode) metadata.demoMode = data.demoMode;
    if (data.demoDate) metadata.demoDate = data.demoDate;
    if (data.demoTime) metadata.demoTime = data.demoTime;
    if (data.demoFaculty) metadata.demoFaculty = data.demoFaculty;
    if (data.rescheduleReason) metadata.rescheduleReason = data.rescheduleReason;
    if (data.callbackDate) metadata.callbackDate = data.callbackDate;
    if (data.callbackTime) metadata.callbackTime = data.callbackTime;
    if (data.cancellationReason) metadata.cancellationReason = data.cancellationReason;
    if (data.admissionMode) metadata.admissionMode = data.admissionMode;
    if (data.courseId) metadata.courseId = data.courseId;
    if (data.admissionDate) metadata.admissionDate = data.admissionDate;
    if (data.paymentStatus) metadata.paymentStatus = data.paymentStatus;

    if (newMainStatus === 'Joined' && !data.courseId && !lead.interestedCourseId && !lead.admission) {
      throw new AppError('Course is required when confirming admission', 400, 'COURSE_REQUIRED');
    }

    const effectiveCourseId = data.courseId || lead.interestedCourseId;
    const cleanRemark = (data.remarks || '').trim() || data.cancellationReason?.trim() || '';
    const storedRemark = cleanRemark || null;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // 1. Update Lead Status + Structured Main/Substatus
      await tx.lead.update({
        where: { id: leadId },
        data: {
          status: targetLeadStatus,
          currentMainStatus: newMainStatus,
          currentSubStatus: newSubStatus,
          lastStatusRemark: storedRemark,
          lastStatusUpdatedAt: now,
          lastStatusUpdatedById: counsellorId,
          ...(effectiveCourseId ? { interestedCourseId: effectiveCourseId } : {}),
          lastActivityAt: now,
          lastActivityById: counsellorId
        }
      });

      // 2. Sync admission status if relevant
      const isJoinedOrConfirmed = newMainStatus === 'Joined';
      const isRegisteredStage = newMainStatus === 'Registration Done';
      if ((isJoinedOrConfirmed || isRegisteredStage) && !lead.admission && effectiveCourseId) {
        const course = await tx.course.findUnique({ where: { id: effectiveCourseId } });
        if (course) {
          const timestamp = Date.now().toString().slice(-4);
          const randomSuffix = Math.floor(100 + Math.random() * 900);
          const admissionCode = `ADM-2026-${timestamp}${randomSuffix}`;

          const initialPaid =
            data.registrationAmount ??
            data.paidFee ??
            (data.paymentStatus === 'Full Paid'
              ? Number(course.feeAmount)
              : data.paymentStatus === 'Pending'
                ? 0
                : isRegisteredStage
                  ? 1000
                  : Number(course.feeAmount));

          const newAdm = await tx.admission.create({
            data: {
              admissionCode,
              leadId,
              courseId: course.id,
              totalFee: course.feeAmount,
              paidFee: initialPaid,
              admissionDate: data.admissionDate ? new Date(data.admissionDate) : now,
              status: targetAdmissionStatus || AdmissionStatus.PENDING_VERIFICATION,
              verifiedByUserId: isJoinedOrConfirmed ? counsellorId : null,
              verifiedAt: isJoinedOrConfirmed ? now : null
            }
          });

          if (lead.partnerId) {
            await tx.partnerCommission.create({
              data: {
                partnerId: lead.partnerId,
                admissionId: newAdm.id,
                commissionAmount: 1000.0,
                status: isJoinedOrConfirmed ? CommissionStatus.ELIGIBLE : CommissionStatus.PENDING
              }
            });
          }
        }
      } else if (lead.admission) {
        await tx.admission.update({
          where: { id: lead.admission.id },
          data: {
            ...(targetAdmissionStatus ? { status: targetAdmissionStatus } : {}),
            ...(effectiveCourseId ? { courseId: effectiveCourseId } : {}),
            ...(data.admissionDate ? { admissionDate: new Date(data.admissionDate) } : {}),
            ...(data.registrationAmount !== undefined || data.paidFee !== undefined
              ? { paidFee: data.registrationAmount ?? data.paidFee }
              : {}),
            ...(targetAdmissionStatus === AdmissionStatus.VERIFIED
              ? { verifiedByUserId: counsellorId, verifiedAt: now }
              : {})
          }
        });

        if (lead.admission.commission) {
          if (targetAdmissionStatus === AdmissionStatus.VERIFIED) {
            await tx.partnerCommission.update({
              where: { id: lead.admission.commission.id },
              data: { status: CommissionStatus.ELIGIBLE }
            });
          } else if (
            targetAdmissionStatus === AdmissionStatus.CANCELLED ||
            targetAdmissionStatus === AdmissionStatus.REJECTED
          ) {
            await tx.partnerCommission.update({
              where: { id: lead.admission.commission.id },
              data: { status: CommissionStatus.ON_HOLD }
            });
          }
        }
      }

      // 3. Dedicated Status History audit record (kept strictly separate from interaction logs)
      await tx.leadActivity.create({
        data: {
          leadId,
          userId: counsellorId,
          activityType: LeadActivityType.STATUS_CHANGE,
          previousStatus: currentStatus,
          newStatus: targetLeadStatus,
          previousMainStatus,
          previousSubStatus,
          newMainStatus,
          newSubStatus,
          remarks: storedRemark || `Status updated to ${newMainStatus}${newSubStatus ? ` (${newSubStatus})` : ''}`,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          scheduledFor: resolvedScheduledFor
        }
      });
    });

    return this.getLeadById(counsellorId, leadId, role);
  }

  /**
   * Convert Lead to Confirmed Admission
   */
  async convertAdmission(counsellorId: string, leadId: string, role: string, data: ConvertAdmissionInput) {
    const lead = await this.getLeadById(counsellorId, leadId, role);

    if (lead.status === LeadStatus.ADMISSION_CONFIRMED) {
      throw new AppError('This lead has already been converted to an admission', 400, 'ALREADY_CONVERTED');
    }

    // Verify course exists
    const course = await prisma.course.findUnique({
      where: { id: data.courseId }
    });
    if (!course) {
      throw new AppError('Selected course not found or is no longer active', 404, 'COURSE_NOT_FOUND');
    }

    // Generate unique Admission Code (e.g. ADM-2026-XXXX)
    const timestamp = Date.now().toString().slice(-4);
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const admissionCode = `ADM-2026-${timestamp}${randomSuffix}`;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Admission
      const admission = await tx.admission.create({
        data: {
          admissionCode,
          leadId,
          courseId: data.courseId,
          totalFee: data.totalFee,
          paidFee: data.paidFee,
          status: AdmissionStatus.PENDING_VERIFICATION,
          verifiedByUserId: null
        }
      });

      // 2. Record initial payment if paidFee > 0
      if (data.paidFee > 0) {
        await tx.admissionPayment.create({
          data: {
            admissionId: admission.id,
            amount: data.paidFee,
            paymentMode: data.paymentMode,
            referenceNumber: data.referenceNumber || null
          }
        });
      }

      // 3. Create Partner Commission if lead was attributed to a partner
      let partnerCommission = null;
      if (lead.partnerId) {
        // Standard flat ₹1,000 commission
        const rule = await tx.commissionRule.findFirst({
          where: { isActive: true }
        });

        const commissionAmount = rule?.commissionType === 'FLAT' ? rule.commissionValue : 1000.0;

        partnerCommission = await tx.partnerCommission.create({
          data: {
            partnerId: lead.partnerId,
            admissionId: admission.id,
            commissionRuleId: rule?.id || null,
            commissionAmount,
            status: CommissionStatus.PENDING
          }
        });
      }

      // 4. Update Lead to ADMISSION_CONFIRMED
      const updatedLead = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.ADMISSION_CONFIRMED,
          interestedCourseId: data.courseId,
          lastActivityAt: new Date(),
          lastActivityById: counsellorId
        }
      });

      // 5. Log Admission Closed Activity
      await tx.leadActivity.create({
        data: {
          leadId,
          userId: counsellorId,
          activityType: LeadActivityType.ADMISSION_CLOSED,
          previousStatus: lead.status,
          newStatus: LeadStatus.ADMISSION_CONFIRMED,
          remarks: `Admission confirmed! Code: ${admissionCode}. Course: ${course.name}. Total Fee: ₹${data.totalFee}, Paid: ₹${data.paidFee} via ${data.paymentMode}. ${data.remarks || ''}`.trim()
        }
      });

      return {
        admission,
        partnerCommission,
        lead: updatedLead
      };
    });

    return result;
  }

  /**
   * Get Active Course Catalog for Admission Intake
   */
  async getCourses() {
    return prisma.course.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        feeAmount: true,
        durationWeeks: true
      },
      orderBy: { name: 'asc' }
    });
  }
}

export const counsellorService = new CounsellorService();

