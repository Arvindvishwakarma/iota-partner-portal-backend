import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import {
  PremisesStatus,
  VisitStatus,
  AffiliateStatus,
  Gender,
  Role,
  MAX_VISIT_PROXIMITY_METERS
} from '../shared';
import { hashPassword } from '../utils/password';
import { env } from '../config/environment';
import { generateUniqueAffiliateCode } from '../utils/affiliate-code';
import { toCapitalCase } from '../validators/public-partner.validator';
import { formatAffiliateBusinessName, toPrismaOccupation } from '../utils/user-display';
import {
  CheckInInput,
  CheckOutInput,
  OnboardPartnerInput
} from '../validators/sales.validator';
import { whatsappOtpService } from './whatsapp-otp.service';
import { emailOtpService } from './email-otp.service';

/**
 * Calculate geographical distance in meters between two lat/lng coordinates (Haversine formula)
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export class SalesService {
  /**
   * Fetch Field Sales Overview & Daily Canvassing Agenda
   */
  async getDashboard(salespersonId: string, role: string) {
    const isSales = role === Role.SALES;
    const baseWhere = isSales ? { salespersonId } : {};

    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

    const [
      assignedPremisesCount,
      todayVisits,
      completedVisitsCount,
      onboardedPartnersCount,
      activeVisit
    ] = await Promise.all([
      prisma.premises.count({
        where: isSales ? { assignedSalesId: salespersonId } : {}
      }),
      prisma.premisesVisit.findMany({
        where: {
          ...baseWhere,
          status: {
            in: [
              VisitStatus.ASSIGNED,
              VisitStatus.IN_PROGRESS,
              VisitStatus.RESCHEDULED
            ]
          }
        },
        include: {
          premises: true
        },
        orderBy: { assignedAt: 'desc' },
        take: 10
      }),
      prisma.premisesVisit.count({
        where: {
          ...baseWhere,
          status: {
            in: [
              VisitStatus.COMPLETED,
              VisitStatus.INTERESTED,
              VisitStatus.NOT_INTERESTED,
              VisitStatus.PARTNER_ONBOARDED,
              VisitStatus.AUTHORIZED_PERSON_NOT_AVAILABLE,
              VisitStatus.PREMISES_CLOSED_TEMPORARY,
              VisitStatus.PREMISES_CLOSED_PERMANENTLY,
              VisitStatus.WRONG_ADDRESS
            ]
          }
        }
      }),
      isSales
        ? prisma.premisesVisit.count({
            where: { salespersonId, status: VisitStatus.PARTNER_ONBOARDED }
          })
        : prisma.affiliate.count({ where: { deletedAt: null } }),
      // Single Active Visit in Progress (if any)
      prisma.premisesVisit.findFirst({
        where: {
          salespersonId,
          status: VisitStatus.IN_PROGRESS
        },
        include: {
          premises: true
        }
      })
    ]);

    return {
      metrics: {
        assignedPremisesCount,
        todayRemaining: todayVisits.filter(
          (v) => v.status === VisitStatus.ASSIGNED || v.status === VisitStatus.RESCHEDULED
        ).length,
        completedVisitsCount,
        onboardedPartnersCount
      },
      activeVisit,
      agenda: todayVisits
    };
  }

  /**
   * Get Premises Route Directory
   */
  async getPremises(
    salespersonId: string,
    role: string,
    filter: { city?: string; search?: string; status?: string }
  ) {
    const isSales = role === Role.SALES;
    const where: any = isSales ? { assignedSalesId: salespersonId } : {};

    if (filter.status) {
      where.currentStatus = filter.status;
    }

    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { premisesName: { contains: q, mode: 'insensitive' } },
        { fullAddress: { contains: q, mode: 'insensitive' } },
        { contactNumber: { contains: q } }
      ];
    }

    const premises = await prisma.premises.findMany({
      where,
      include: {
        visits: {
          where: isSales ? { salespersonId } : {},
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    return premises;
  }

  /**
   * Execute GPS Check-In at Premises (Strict Single-Active-Visit & Proximity Rule)
   */
  async checkIn(salespersonId: string, premisesId: string, data: CheckInInput) {
    // 1. Single Active Visit Constraint: Rep cannot have two visits in progress simultaneously
    const activeVisit = await prisma.premisesVisit.findFirst({
      where: {
        salespersonId,
        status: VisitStatus.IN_PROGRESS
      },
      include: { premises: { select: { premisesName: true } } }
    });

    if (activeVisit) {
      throw new AppError(
        `Active visit already in progress at '${activeVisit.premises.premisesName}'. You must check out of your active visit before starting a new one.`,
        400,
        'SINGLE_ACTIVE_VISIT_VIOLATION'
      );
    }

    // 2. Fetch target premises details
    const premises = await prisma.premises.findUnique({
      where: { id: premisesId }
    });

    if (!premises) {
      throw new AppError('Premises not found', 404, 'NOT_FOUND');
    }

    // 3. Proximity Check (Optional, GPS tracking removed per user specification)
    let calculatedDistance: number | null = null;
    if (premises.latitude && premises.longitude && data.latitude && data.longitude) {
      calculatedDistance = calculateHaversineDistanceMeters(
        data.latitude,
        data.longitude,
        premises.latitude,
        premises.longitude
      );
    } else if (data.latitude && data.longitude) {
      // If premises does not have GPS coordinates yet, record the rep's coordinates
      await prisma.premises.update({
        where: { id: premisesId },
        data: {
          latitude: data.latitude,
          longitude: data.longitude
        }
      });
    }

    // 4. Find existing ASSIGNED visit or create a new visit record in IN_PROGRESS
    const existingVisit = await prisma.premisesVisit.findFirst({
      where: {
        premisesId,
        salespersonId,
        status: VisitStatus.ASSIGNED
      }
    });

    const visit = existingVisit
      ? await prisma.premisesVisit.update({
          where: { id: existingVisit.id },
          data: {
            status: VisitStatus.IN_PROGRESS,
            visitedAt: new Date(),
            checkinLatitude: data.latitude,
            checkinLongitude: data.longitude,
            distanceFromTarget: calculatedDistance
          },
          include: { premises: true }
        })
      : await prisma.premisesVisit.create({
          data: {
            premisesId,
            salespersonId,
            status: VisitStatus.IN_PROGRESS,
            visitedAt: new Date(),
            checkinLatitude: data.latitude,
            checkinLongitude: data.longitude,
            distanceFromTarget: calculatedDistance
          },
          include: { premises: true }
        });

    // Update premises status to VISITED
    await prisma.premises.update({
      where: { id: premisesId },
      data: { currentStatus: PremisesStatus.VISITED }
    });

    return visit;
  }

  /**
   * Check Out of an Active Visit & Record Field Outcome
   */
  async checkOut(salespersonId: string, visitId: string, data: CheckOutInput) {
    const visit = await prisma.premisesVisit.findUnique({
      where: { id: visitId },
      include: { premises: true }
    });

    if (!visit) {
      throw new AppError('Visit record not found', 404, 'NOT_FOUND');
    }

    if (visit.salespersonId !== salespersonId) {
      throw new AppError('You are not authorized to check out of this visit', 403, 'FORBIDDEN');
    }

    // Map premises status based on outcome
    let nextPremisesStatus: PremisesStatus = PremisesStatus.VISITED;
    if (data.status === VisitStatus.PARTNER_ONBOARDED) {
      nextPremisesStatus = PremisesStatus.PARTNER_ONBOARDED;
    } else if (data.status === VisitStatus.NOT_INTERESTED) {
      nextPremisesStatus = PremisesStatus.NOT_INTERESTED;
    }

    const updatedVisit = await prisma.$transaction(async (tx) => {
      const v = await tx.premisesVisit.update({
        where: { id: visitId },
        data: {
          status: data.status,
          remarks: data.remarks,
          photoUrl: data.photoUrl || null,
          scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null
        },
        include: { premises: true }
      });

      await tx.premises.update({
        where: { id: visit.premisesId },
        data: { currentStatus: nextPremisesStatus }
      });

      return v;
    });

    return updatedVisit;
  }

  /**
   * Update Visit / Premises Status Directly (No GPS Required)
   */
  async updateVisitStatus(
    salespersonId: string,
    targetId: string,
    data: {
      status: VisitStatus;
      remarks?: string;
      scheduledDate?: string | null;
      photoUrl?: string | null;
    }
  ) {
    let visit = await prisma.premisesVisit.findFirst({
      where: {
        OR: [{ id: targetId }, { premisesId: targetId }]
      },
      orderBy: { createdAt: 'desc' },
      include: { premises: true }
    });

    if (!visit) {
      const premises = await prisma.premises.findUnique({ where: { id: targetId } });
      if (!premises) {
        throw new AppError('Premises not found', 404, 'NOT_FOUND');
      }

      visit = await prisma.premisesVisit.create({
        data: {
          premisesId: premises.id,
          salespersonId,
          status: data.status,
          remarks: data.remarks || null,
          scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
          visitedAt: new Date()
        },
        include: { premises: true }
      });
    }

    let nextPremisesStatus: PremisesStatus = PremisesStatus.VISITED;
    if (data.status === VisitStatus.PARTNER_ONBOARDED) {
      nextPremisesStatus = PremisesStatus.PARTNER_ONBOARDED;
    } else if (data.status === VisitStatus.NOT_INTERESTED) {
      nextPremisesStatus = PremisesStatus.NOT_INTERESTED;
    } else if (data.status === VisitStatus.ASSIGNED || data.status === VisitStatus.RESCHEDULED) {
      nextPremisesStatus = PremisesStatus.ASSIGNED;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.premisesVisit.update({
        where: { id: visit!.id },
        data: {
          status: data.status,
          remarks: data.remarks !== undefined ? data.remarks : visit!.remarks,
          photoUrl: data.photoUrl || visit!.photoUrl,
          visitedAt: new Date(),
          scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : visit!.scheduledDate
        },
        include: { premises: true }
      });

      await tx.premises.update({
        where: { id: visit!.premisesId },
        data: { currentStatus: nextPremisesStatus }
      });

      // If status is PARTNER_ONBOARDED, ensure Affiliate record exists in PENDING_APPROVAL status for Super Admin review
      if (data.status === VisitStatus.PARTNER_ONBOARDED) {
        const prem = await tx.premises.findUnique({
          where: { id: visit!.premisesId }
        });

        if (prem) {
          const rawPhone = prem.contactNumber.replace(/\D/g, '').slice(-10);
          const normalizedMobile = rawPhone.length === 10 ? `+91${rawPhone}` : prem.contactNumber;
          const email = `${rawPhone || prem.id.slice(0, 8)}@affiliate.iotaacademy.in`;

          const existingAffiliate = await tx.affiliate.findFirst({
            where: { OR: [{ emailAddress: email }, { mobileNumber: normalizedMobile }] }
          });

          if (!existingAffiliate) {
            let user = await tx.user.findFirst({
              where: { OR: [{ emailAddress: email }, { mobileNumber: normalizedMobile }] }
            });

            const nameParts = prem.premisesName.trim().split(/\s+/);
            const firstName = toCapitalCase(nameParts[0] || 'Affiliate');
            const lastName = toCapitalCase(nameParts.slice(1).join(' ') || 'Partner');

            if (!user) {
              const defaultPasswordHash = await hashPassword('Partner@123456');
              user = await tx.user.create({
                data: {
                  firstName,
                  lastName,
                  emailAddress: email,
                  mobileNumber: normalizedMobile,
                  whatsappNumber: normalizedMobile,
                  password: defaultPasswordHash,
                  role: Role.AFFILIATE as any,
                  gender: Gender.Other as any,
                  age: 25,
                  occupation: toPrismaOccupation('Business Owner'),
                  communicationAddress: prem.fullAddress,
                  isActive: false
                }
              });
            }

            const affiliateCode = await generateUniqueAffiliateCode(tx);
            const frontendBase = (env.FRONTEND_URL || 'https://affiliate.iotaacademy.in').replace(/\/+$/, '');
            const registrationUrl = `${frontendBase}/register/${affiliateCode}`;

            await tx.affiliate.create({
              data: {
                userId: user.id,
                affiliateCode,
                registrationUrl,
                firstName,
                lastName,
                gender: Gender.Other as any,
                age: 25,
                mobileNumber: normalizedMobile,
                whatsappNumber: normalizedMobile,
                emailAddress: email,
                communicationAddress: prem.fullAddress,
                city: 'Indore',
                state: 'Madhya Pradesh',
                pincode: '452001',
                occupation: toPrismaOccupation('Business Owner'),
                firmName: prem.premisesName,
                status: AffiliateStatus.PENDING_APPROVAL
              }
            });
          }
        }
      }

      return v;
    });

    return updated;
  }

  /**
   * Get Visit or Premises Details for Sales Update Console
   */
  async getVisitDetails(salespersonId: string, targetId: string) {
    const visit = await prisma.premisesVisit.findFirst({
      where: {
        OR: [{ id: targetId }, { premisesId: targetId }]
      },
      orderBy: { createdAt: 'desc' },
      include: { premises: true }
    });

    if (visit) {
      return {
        id: visit.id,
        status: visit.status,
        scheduledDate: visit.scheduledDate,
        remarks: visit.remarks,
        photoUrl: visit.photoUrl,
        visitedAt: visit.visitedAt,
        premises: visit.premises
      };
    }

    const premises = await prisma.premises.findUnique({
      where: { id: targetId }
    });

    if (!premises) {
      throw new AppError('Premises or visit not found', 404, 'NOT_FOUND');
    }

    return {
      id: null,
      status: VisitStatus.ASSIGNED,
      scheduledDate: null,
      remarks: null,
      photoUrl: null,
      visitedAt: null,
      premises
    };
  }

  /**
   * Onboard Partner On-The-Spot (Direct Field Registration)
   */
  async onboardPartner(salespersonId: string, data: OnboardPartnerInput) {
    const cleanDigits = data.mobile.replace(/\D/g, '').slice(-10);
    const normalizedMobile = `+91${cleanDigits}`;
    const cleanWaDigits = (data.whatsapp || cleanDigits).replace(/\D/g, '').slice(-10);
    const normalizedWhatsapp = `+91${cleanWaDigits}`;
    const emailLower = data.email.trim().toLowerCase();

    const [existingUser, existingAffiliate] = await Promise.all([
      prisma.user.findFirst({
        where: { OR: [{ emailAddress: emailLower }, { mobileNumber: normalizedMobile }] }
      }),
      prisma.affiliate.findFirst({
        where: { OR: [{ emailAddress: emailLower }, { mobileNumber: normalizedMobile }] }
      })
    ]);

    if (existingUser || existingAffiliate) {
      throw new AppError(
        'A user or affiliate with this email or mobile phone number already exists',
        400,
        'DUPLICATE_PARTNER'
      );
    }

    const affiliateCode = await generateUniqueAffiliateCode();
    const defaultPassword = 'Partner@123456';
    const passwordHash = await hashPassword(defaultPassword);

    const nameParts = toCapitalCase(data.ownerName).split(/\s+/);
    const firstName = nameParts[0] || 'Affiliate';
    const lastName = nameParts.slice(1).join(' ') || 'Partner';

    const partner = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName,
          lastName,
          emailAddress: emailLower,
          mobileNumber: normalizedMobile,
          whatsappNumber: normalizedWhatsapp,
          password: passwordHash,
          role: Role.AFFILIATE as any,
          gender: Gender.Other as any,
          age: 25,
          occupation: toPrismaOccupation('Business Owner'),
          communicationAddress: data.addressLine1,
          isActive: true
        }
      });

      const registrationUrl = `${env.FRONTEND_URL}/register/${affiliateCode}`;

      const newPartner = await tx.affiliate.create({
        data: {
          userId: user.id,
          affiliateCode,
          registrationUrl,
          firstName,
          lastName,
          gender: Gender.Other as any,
          age: 25,
          mobileNumber: normalizedMobile,
          whatsappNumber: normalizedWhatsapp,
          emailAddress: emailLower,
          communicationAddress: data.addressLine1,
          city: toCapitalCase(data.city),
          state: 'Madhya Pradesh',
          pincode: data.pincode,
          occupation: toPrismaOccupation('Business Owner'),
          firmName: data.businessName,
          ownerBusinessType: data.category ? String(data.category).replace(/_/g, ' ') : null,
          status: AffiliateStatus.PENDING_APPROVAL,
          bankAccountHolderName: data.bankAccountName || null,
          bankAccountNumber: data.bankAccountNumber || null,
          bankIfscNumber: data.bankIfsc || null,
          bankName: data.bankName || null
        }
      });

      if (data.onboardingFormImage) {
        try {
          await tx.partnerDocument.create({
            data: {
              partnerId: newPartner.id,
              documentType: 'ONBOARDING_FORM',
              fileUrl: data.onboardingFormImage,
              originalName: 'onboarding-form.jpg',
              mimeType: 'image/jpeg',
              fileSize: Math.round((data.onboardingFormImage.length * 3) / 4),
              isVerified: false
            }
          });
        } catch (docErr) {
          console.warn('Failed to create partner document record for onboarding form:', docErr);
        }
      }

      if (data.premisesId) {
        await tx.premises.update({
          where: { id: data.premisesId },
          data: { currentStatus: PremisesStatus.PARTNER_ONBOARDED }
        });

        await tx.premisesVisit.updateMany({
          where: {
            premisesId: data.premisesId,
            salespersonId,
            status: VisitStatus.IN_PROGRESS
          },
          data: {
            status: VisitStatus.PARTNER_ONBOARDED,
            remarks: `On-the-spot onboarded! Code: ${affiliateCode}`
          }
        });
      }

      return newPartner;
    });

    whatsappOtpService.sendAffiliateRegistrationWhatsApp(cleanWaDigits, firstName).catch((waErr) => {
      console.warn('[Sales Onboard Partner WhatsApp] Dispatch warning:', waErr);
    });

    if (data.email) {
      emailOtpService.sendAffiliateRegistrationEmail(emailLower, firstName).catch((mailErr) => {
        console.warn('[Sales Onboard Partner Email] Dispatch warning:', mailErr);
      });
    }

    return {
      ...partner,
      partnerCode: partner.affiliateCode,
      businessName: formatAffiliateBusinessName(partner),
      ownerName: `${partner.firstName} ${partner.lastName}`.trim()
    };
  }

  /**
   * Global Partner Leads Monitor with PII Masking
   * Sales reps see student pipeline progress without unmasked phone numbers
   */
  async getLeads(
    salespersonId: string,
    role: string,
    filter: { search?: string; status?: string; page?: number; limit?: number }
  ) {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { studentName: { contains: q, mode: 'insensitive' } },
        { leadCode: { contains: q, mode: 'insensitive' } },
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
          mobile: true, // will be masked before returning!
          city: true,
          status: true,
          createdAt: true,
          interestedCourse: { select: { name: true } },
          partner: { select: { id: true, affiliateCode: true, firstName: true, lastName: true, firmName: true, occupation: true } },
          admission: {
            select: {
              admissionCode: true,
              paidFee: true,
              totalFee: true,
              commission: { select: { commissionAmount: true, status: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    // Mask phone numbers to ensure student privacy: +91 98****3210
    const maskedLeads = leads.map((l) => ({
      ...l,
      mobile: l.mobile.replace(/(\+91\d{2})\d{4}(\d{4})/, '$1****$2'),
      partner: l.partner
        ? { id: l.partner.id, partnerCode: l.partner.affiliateCode, businessName: formatAffiliateBusinessName(l.partner) }
        : null
    }));

    return {
      leads: maskedLeads,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}

export const salesService = new SalesService();

