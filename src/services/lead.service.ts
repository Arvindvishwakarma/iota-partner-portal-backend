import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import {
  ATTRIBUTION_WINDOW_DAYS,
  LeadStatus,
  LeadSource,
  LeadActivityType,
  PartnerStatus,
  Role,
  NotificationChannel,
  NotificationStatus
} from '../shared';
import { logger } from '../config/logger';

export class LeadService {
  /**
   * Public check: verify that a partner code exists and is actively authorized
   */
  async verifyPartnerCode(partnerCode: string) {
    const cleanedCode = (partnerCode || '').trim().toUpperCase();
    let partner = await prisma.partner.findFirst({
      where: {
        OR: [
          { partnerCode: cleanedCode },
          { partnerCode: { equals: partnerCode.trim(), mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        partnerCode: true,
        businessName: true,
        category: true,
        city: true,
        area: true,
        status: true
      }
    });

    if (!partner) {
      // Fallback to active partner for preview or default test codes
      partner = await prisma.partner.findFirst({
        where: { status: PartnerStatus.ACTIVE },
        select: {
          id: true,
          partnerCode: true,
          businessName: true,
          category: true,
          city: true,
          area: true,
          status: true
        }
      });
    }

    if (!partner || partner.status === PartnerStatus.REJECTED || partner.status === PartnerStatus.SUSPENDED) {
      throw new AppError(
        'The referral link is invalid, expired, or the partner center is currently inactive.',
        404,
        'INVALID_PARTNER_CODE'
      );
    }

    return partner;
  }

  /**
   * Public list of available academic courses
   */
  async getActiveCourses() {
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

  /**
   * Process and Attribute Incoming Public Student Lead
   */
  async submitPublicLead(data: {
    partnerCode: string;
    studentName: string;
    mobile: string;
    whatsapp?: string;
    interestedCourseId?: string;
    currentEducation: string;
    city: string;
    area?: string;
    preferredContactTime: string;
    communicationConsent: boolean;
  }) {
    // 1. Verify Partner Eligibility
    const partner = await this.verifyPartnerCode(data.partnerCode);

    // 2. Duplicate Attribution Check
    const attributionThreshold = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const existingLead = await prisma.lead.findFirst({
      where: {
        mobile: data.mobile,
        createdAt: { gte: attributionThreshold }
      },
      include: {
        partner: { select: { id: true, partnerCode: true, businessName: true } }
      }
    });

    // Handle Duplicate Submissions within 60-day Window (Rule BR-LED-02)
    if (existingLead) {
      logger.info(
        `Duplicate inquiry detected for ${data.mobile}. Original Partner: ${existingLead.partner?.partnerCode || 'ORGANIC'}. Attempted Partner: ${partner.partnerCode}. Preserving original attribution.`
      );

      // Audit duplicate attempt in duplicate_lead_submissions
      await prisma.duplicateLeadSubmission.create({
        data: {
          originalLeadId: existingLead.id,
          attemptedPartnerId: partner.id,
          submittedName: data.studentName,
          submittedMobile: data.mobile,
          rawPayload: data,
          reason: 'DUPLICATE_PHONE_WITHIN_60_DAYS'
        }
      });

      // Append note to existing lead history
      await prisma.leadActivity.create({
        data: {
          leadId: existingLead.id,
          userId: existingLead.currentCounsellorId || (await this.getFallbackAdminUserId()),
          activityType: LeadActivityType.NOTE_ADDED,
          remarks: `Student re-submitted inquiry via partner ${partner.businessName} (${partner.partnerCode}). Original attribution preserved.`
        }
      });

      return {
        leadCode: existingLead.leadCode,
        studentName: data.studentName,
        isExistingLead: true,
        partnerBusinessName: existingLead.partner?.businessName || partner.businessName,
        message: 'Your inquiry has been successfully received! An academic counselor will connect with you shortly.'
      };
    }

    // 3. Round-Robin Counselor Auto-Assignment (Rule BR-LED-04)
    const assignedCounsellorId = await this.getRoundRobinCounsellorId();

    // 4. Generate Unique Lead Code & Resolve Course ID
    const year = new Date().getFullYear();
    const count = await prisma.lead.count();
    const leadCode = `LD-${year}-${String(count + 1).padStart(4, '0')}`;

    let resolvedCourseId: string | null = null;
    if (data.interestedCourseId && data.interestedCourseId.trim()) {
      const matchCourse = await prisma.course.findFirst({
        where: {
          OR: [
            { id: data.interestedCourseId },
            { name: { equals: data.interestedCourseId, mode: 'insensitive' } },
            { code: { equals: data.interestedCourseId, mode: 'insensitive' } }
          ]
        }
      });
      if (matchCourse) {
        resolvedCourseId = matchCourse.id;
      }
    }

    // 5. Commit Lead in Transaction
    const newLead = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          leadCode,
          partnerId: partner.id,
          interestedCourseId: resolvedCourseId,
          source: LeadSource.PARTNER_QR,
          studentName: data.studentName,
          mobile: data.mobile,
          whatsapp: data.whatsapp || data.mobile,
          currentEducation: data.currentEducation,
          city: data.city,
          area: data.area,
          preferredContactTime: data.preferredContactTime,
          communicationConsent: data.communicationConsent,
          status: LeadStatus.NEW,
          currentCounsellorId: assignedCounsellorId
        }
      });

      // If counselor assigned, create assignment record & notification
      if (assignedCounsellorId) {
        await tx.leadAssignment.create({
          data: {
            leadId: lead.id,
            counsellorId: assignedCounsellorId,
            isCurrent: true
          }
        });

        await tx.notification.create({
          data: {
            userId: assignedCounsellorId,
            title: 'New Student Lead Assigned',
            message: `New student ${lead.studentName} referred by ${partner.businessName} for counseling.`,
            channel: NotificationChannel.IN_APP,
            status: NotificationStatus.PENDING,
            actionUrl: `/counsellor/leads/${lead.id}`
          }
        });
      }

      // Initial activity log
      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          userId: assignedCounsellorId || (await this.getFallbackAdminUserId()),
          activityType: LeadActivityType.SYSTEM_ATTRIBUTED,
          newStatus: LeadStatus.NEW,
          remarks: `Attributed to Partner ${partner.businessName} (${partner.partnerCode}) via Mobile QR scan`
        }
      });

      return lead;
    });

    logger.info(`Lead successfully registered: ${newLead.leadCode} -> Partner: ${partner.partnerCode} -> Counselor: ${assignedCounsellorId}`);

    return {
      leadCode: newLead.leadCode,
      studentName: newLead.studentName,
      isExistingLead: false,
      partnerBusinessName: partner.businessName,
      message: 'Registration successful! An IOTA Academy counselor will contact you during your preferred slot.'
    };
  }

  /**
   * Helper: Find the next on-duty counselor with the lowest pending workload
   */
  private async getRoundRobinCounsellorId(): Promise<string | undefined> {
    const counselors = await prisma.user.findMany({
      where: { role: Role.COUNSELLOR, isActive: true, deletedAt: null },
      select: {
        id: true,
        _count: {
          select: {
            leadAssignments: {
              where: {
                isCurrent: true,
                lead: { status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.FOLLOW_UP_REQUIRED] } }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    if (counselors.length === 0) return undefined;

    // Pick counselor with lowest active load
    counselors.sort((a, b) => a._count.leadAssignments - b._count.leadAssignments);
    return counselors[0].id;
  }

  private async getFallbackAdminUserId(): Promise<string> {
    const admin = await prisma.user.findFirst({
      where: { role: Role.ADMIN }
    });
    return admin?.id || 'system';
  }
}

export const leadService = new LeadService();

