import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import {
  ATTRIBUTION_WINDOW_DAYS,
  LeadStatus,
  LeadSource,
  LeadActivityType,
  AffiliateStatus,
  Role,
  NotificationChannel,
  NotificationStatus
} from '../shared';
import { logger } from '../config/logger';
import { toCapitalCase } from '../validators/public-lead.validator';
import { formatAffiliateBusinessName } from '../utils/user-display';
import { whatsappOtpService } from './whatsapp-otp.service';

export class LeadService {
  /**
   * Public check: verify that an affiliate code exists and is actively authorized
   */
  async verifyPartnerCode(partnerCode: string) {
    const rawCode = (partnerCode || '').trim();
    if (!rawCode) {
      throw new AppError(
        'Invalid referral link. No affiliate code was provided.',
        404,
        'INVALID_PARTNER_CODE'
      );
    }

    const cleanedCode = rawCode.toUpperCase();
    const affiliate = await prisma.affiliate.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { affiliateCode: cleanedCode },
          { affiliateCode: { equals: rawCode, mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        affiliateCode: true,
        firstName: true,
        lastName: true,
        firmName: true,
        occupation: true,
        city: true,
        state: true,
        status: true,
        user: {
          select: {
            isActive: true,
            deletedAt: true
          }
        }
      }
    });

    if (!affiliate) {
      throw new AppError(
        'The referral link is invalid or does not match any registered affiliate.',
        404,
        'INVALID_PARTNER_CODE'
      );
    }

    if (affiliate.status === AffiliateStatus.PENDING_APPROVAL) {
      throw new AppError(
        'This affiliate account is currently pending approval. Student registrations are paused until the affiliate is verified and activated.',
        403,
        'PARTNER_PENDING_APPROVAL'
      );
    }

    if (affiliate.status !== AffiliateStatus.ACTIVE || !affiliate.user?.isActive || affiliate.user?.deletedAt) {
      throw new AppError(
        'This affiliate account is currently inactive or suspended and cannot accept student registrations.',
        403,
        'PARTNER_INACTIVE'
      );
    }

    return {
      id: affiliate.id,
      partnerCode: affiliate.affiliateCode,
      affiliateCode: affiliate.affiliateCode,
      businessName: formatAffiliateBusinessName(affiliate),
      city: affiliate.city,
      area: affiliate.state,
      status: affiliate.status
    };
  }

  /**
   * Public list of available academic courses
   */
  async getActiveCourses() {
    const courses = await prisma.course.findMany({
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

    const preferredOrder = [
      'Data Analytics with AI',
      'Data Science with AI',
      'Business Analytics with AI',
      'Machine Learning with AI',
      'Artificial Intelligence with AI',
      'Full Stack Development with AI',
      'Not sure yet - need guidance'
    ];

    return courses.sort((a, b) => {
      const idxA = preferredOrder.findIndex((name) => name.toLowerCase() === a.name.toLowerCase());
      const idxB = preferredOrder.findIndex((name) => name.toLowerCase() === b.name.toLowerCase());
      const orderA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
      const orderB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Normalize to 10-digit Indian phone and E.164 variants for duplicate matching across leads
   */
  private buildPhoneMatchVariants(rawPhones: Array<string | undefined | null>): string[] {
    const variants = new Set<string>();
    for (const raw of rawPhones) {
      const digits = (raw || '').replace(/\D/g, '').slice(-10);
      if (/^[6-9]\d{9}$/.test(digits)) {
        variants.add(digits);
        variants.add(`+91${digits}`);
      }
    }
    return Array.from(variants);
  }

  private async findDuplicateLeadByPhones(rawPhones: Array<string | undefined | null>) {
    const variants = this.buildPhoneMatchVariants(rawPhones);
    if (variants.length === 0) return null;

    const attributionThreshold = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return prisma.lead.findFirst({
      where: {
        createdAt: { gte: attributionThreshold },
        OR: [{ mobile: { in: variants } }, { whatsapp: { in: variants } }]
      },
      include: {
        partner: {
          select: { id: true, affiliateCode: true, firstName: true, lastName: true, firmName: true, occupation: true }
        }
      }
    });
  }

  /**
   * Non-PII check whether an enquiry already exists for a mobile or WhatsApp number
   */
  async checkDuplicatePhone(
    mobile?: string,
    whatsapp?: string
  ): Promise<{ isDuplicate: boolean; message?: string }> {
    const existing = await this.findDuplicateLeadByPhones([mobile, whatsapp]);
    if (existing) {
      return {
        isDuplicate: true,
        message: 'An enquiry has already been submitted with this phone number.'
      };
    }
    return { isDuplicate: false };
  }

  /**
   * Process and Attribute Incoming Public Student Lead
   */
  async submitPublicLead(data: {
    partnerCode: string;
    studentName: string;
    mobile: string;
    whatsapp: string;
    whatsappVerificationToken: string;
    otpSessionId: string;
    interestedCourseId: string;
    currentEducation: string;
    city: string;
    preferredContactTime: string;
    preferredLearningMode?: string;
    communicationConsent: boolean;
    consentVersion?: string;
  }) {
    // 0. Enforce server-side single-use WhatsApp OTP verification bound to exact number & session (never bypassed)
    const isWhatsappVerified = whatsappOtpService.consumePhoneVerification(
      data.whatsapp,
      data.whatsappVerificationToken,
      data.otpSessionId
    );
    if (!isWhatsappVerified) {
      throw new AppError(
        'WhatsApp number verification is missing, expired, or invalid for this enquiry session. Please verify your WhatsApp number via OTP.',
        400,
        'WHATSAPP_NOT_VERIFIED'
      );
    }

    // 1. Verify Partner Eligibility (kept strictly internal for attribution)
    const partner = await this.verifyPartnerCode(data.partnerCode);

    // 2. Duplicate Attribution Check (matches mobile or WhatsApp within 60-day window)
    const existingLead = await this.findDuplicateLeadByPhones([data.mobile, data.whatsapp]);

    // Handle Duplicate Submissions within 60-day Window (Rule BR-LED-02)
    if (existingLead) {
      logger.info(
        `Duplicate enquiry detected for ${data.mobile}. Original Partner: ${existingLead.partner?.affiliateCode || 'ORGANIC'}. Attempted Partner: ${partner.partnerCode}. Preserving original attribution.`
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
          remarks: `Student re-submitted enquiry via partner ${partner.businessName} (${partner.partnerCode}). Original attribution preserved.`
        }
      });

      throw new AppError(
        'Duplicate enquiry: an enquiry has already been submitted with this phone number. Our team already has your details and will contact you shortly.',
        409,
        'DUPLICATE_LEAD'
      );
    }

    // 3. Round-Robin Counselor Auto-Assignment (Rule BR-LED-04)
    const assignedCounsellorId = await this.getRoundRobinCounsellorId();

    // 4. Generate Unique Lead Code (IALD000101, IALD000102, ...) & Resolve Course ID
    const leadCode = await this.generateUniqueLeadCode();

    let resolvedCourseId: string | null = null;
    if (data.interestedCourseId && data.interestedCourseId.trim()) {
      const matchCourse = await prisma.course.findFirst({
        where: {
          isActive: true,
          OR: [
            { id: data.interestedCourseId },
            { name: { equals: data.interestedCourseId, mode: 'insensitive' } },
            { code: { equals: data.interestedCourseId, mode: 'insensitive' } }
          ]
        }
      });
      if (!matchCourse) {
        throw new AppError('Please select a valid active course.', 400, 'INVALID_COURSE');
      }
      resolvedCourseId = matchCourse.id;
    }

    const fallbackUserId = assignedCounsellorId || (await this.getFallbackAdminUserId());
    const now = new Date();

    // 5. Commit Lead in Transaction
    const newLead = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          leadCode,
          partnerId: partner.id,
          interestedCourseId: resolvedCourseId,
          source: LeadSource.PARTNER_QR,
          studentName: toCapitalCase(data.studentName),
          mobile: data.mobile,
          whatsapp: data.whatsapp || data.mobile,
          currentEducation: data.currentEducation.trim(),
          city: toCapitalCase(data.city),
          preferredContactTime: data.preferredContactTime,
          preferredLearningMode: data.preferredLearningMode || 'OFFLINE',
          communicationConsent: data.communicationConsent,
          consentAt: now,
          consentVersion: data.consentVersion || 'v1.0',
          whatsappOtpVerified: true,
          status: LeadStatus.NEW,
          currentMainStatus: 'Not Connected Yet',
          currentCounsellorId: assignedCounsellorId,
          lastActivityAt: now,
          lastActivityById: fallbackUserId
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
            message: `New student ${lead.studentName} referred by ${partner.businessName} for counselling.`,
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
      message:
        'Thank you for your enquiry! Our IOTA Academy counsellor will contact you shortly to assist you with your course enquiry and free demo.'
    };
  }

  /**
   * Generate sequential unique lead code starting from IALD000101
   */
  private async generateUniqueLeadCode(): Promise<string> {
    const existingCodes = await prisma.lead.findMany({
      where: { leadCode: { startsWith: 'IALD' } },
      select: { leadCode: true }
    });

    let maxNum = 100;
    for (const row of existingCodes) {
      const match = /^IALD(\d+)$/i.exec(row.leadCode.trim());
      if (match) {
        const num = parseInt(match[1], 10);
        if (!Number.isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }

    let candidateNum = maxNum + 1;
    while (true) {
      const code = `IALD${String(candidateNum).padStart(6, '0')}`;
      const conflict = await prisma.lead.findUnique({
        where: { leadCode: code },
        select: { id: true }
      });
      if (!conflict) {
        return code;
      }
      candidateNum += 1;
    }
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

