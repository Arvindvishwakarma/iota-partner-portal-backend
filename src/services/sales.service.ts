import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import {
  PremisesStatus,
  VisitStatus,
  PartnerStatus,
  Role,
  MAX_VISIT_PROXIMITY_METERS
} from '../shared';
import { hashPassword } from '../utils/password';
import { env } from '../config/environment';
import {
  CheckInInput,
  CheckOutInput,
  OnboardPartnerInput
} from '../validators/sales.validator';

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
          status: { in: [VisitStatus.ASSIGNED, VisitStatus.IN_PROGRESS] }
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
              VisitStatus.PARTNER_ONBOARDED
            ]
          }
        }
      }),
      prisma.partner.count({
        where: isSales ? { onboardedByUserId: salespersonId } : {}
      }),
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
        todayRemaining: todayVisits.filter((v) => v.status === VisitStatus.ASSIGNED).length,
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

    if (filter.city) {
      where.city = { contains: filter.city, mode: 'insensitive' };
    }

    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { premisesName: { contains: q, mode: 'insensitive' } },
        { ownerName: { contains: q, mode: 'insensitive' } },
        { area: { contains: q, mode: 'insensitive' } },
        { mobile: { contains: q } }
      ];
    }

    const premises = await prisma.premises.findMany({
      where,
      include: {
        partner: {
          select: { id: true, partnerCode: true, businessName: true, status: true }
        },
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

    // 3. Proximity Check (Haversine formula): <= 500m
    let calculatedDistance: number | null = null;
    if (premises.latitude && premises.longitude) {
      calculatedDistance = calculateHaversineDistanceMeters(
        data.latitude,
        data.longitude,
        premises.latitude,
        premises.longitude
      );

      if (calculatedDistance > MAX_VISIT_PROXIMITY_METERS) {
        throw new AppError(
          `GPS Verification Failed: You are ${calculatedDistance} meters away from ${premises.premisesName}. Check-in is only permitted within ${MAX_VISIT_PROXIMITY_METERS} meters.`,
          400,
          'PROXIMITY_CHECK_FAILED'
        );
      }
    } else {
      // If premises does not have GPS coordinates yet, record the rep's coordinates as the verified location!
      await prisma.premises.update({
        where: { id: premisesId },
        data: {
          latitude: data.latitude,
          longitude: data.longitude
        }
      });
      calculatedDistance = 0;
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

    if (visit.status !== VisitStatus.IN_PROGRESS) {
      throw new AppError(
        `Cannot check out of visit with status '${visit.status}'. Visit must be 'IN_PROGRESS'.`,
        400,
        'INVALID_VISIT_STATUS'
      );
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
   * Onboard Partner On-The-Spot (Direct Field Registration)
   */
  async onboardPartner(salespersonId: string, data: OnboardPartnerInput) {
    // 1. Check duplicate email or phone
    const normalizedMobile = data.mobile.startsWith('+91') ? data.mobile : `+91${data.mobile}`;
    const [existingUser, existingPartner] = await Promise.all([
      prisma.user.findFirst({
        where: { OR: [{ email: data.email }, { phone: normalizedMobile }] }
      }),
      prisma.partner.findFirst({
        where: { OR: [{ email: data.email }, { mobile: normalizedMobile }] }
      })
    ]);

    if (existingUser || existingPartner) {
      throw new AppError(
        'A user or partner with this email or mobile phone number already exists',
        400,
        'DUPLICATE_PARTNER'
      );
    }

    // 2. Generate unique Partner Code e.g. PTR-BLR-0005
    const cityPrefix = data.city.slice(0, 3).toUpperCase();
    const count = await prisma.partner.count();
    const codeNumber = (count + 1).toString().padStart(4, '0');
    const partnerCode = `PTR-${cityPrefix}-${codeNumber}`;

    // 3. Hash default password
    const defaultPassword = 'Partner@123456';
    const passwordHash = await hashPassword(defaultPassword);

    const partner = await prisma.$transaction(async (tx) => {
      // Create user login
      const user = await tx.user.create({
        data: {
          email: data.email,
          phone: normalizedMobile,
          fullName: data.ownerName,
          passwordHash,
          role: Role.PARTNER,
          isActive: true
        }
      });

      const registrationUrl = `${env.FRONTEND_URL}/register/${partnerCode}`;

      // Create partner profile
      const newPartner = await tx.partner.create({
        data: {
          userId: user.id,
          partnerCode,
          businessName: data.businessName,
          category: data.category,
          ownerName: data.ownerName,
          contactPerson: data.contactPerson || data.ownerName,
          mobile: normalizedMobile,
          whatsapp: data.whatsapp ? `+91${data.whatsapp}` : normalizedMobile,
          email: data.email,
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2 || null,
          city: data.city,
          area: data.area,
          pincode: data.pincode,
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          registrationUrl,
          status: PartnerStatus.PENDING_APPROVAL,
          onboardedByUserId: salespersonId,
          premisesId: data.premisesId || null,
          bankAccountName: data.bankAccountName || null,
          bankAccountNumber: data.bankAccountNumber || null,
          bankIfsc: data.bankIfsc || null,
          bankName: data.bankName || null,
          upiId: data.upiId || null
        }
      });

      // If linked to a premises, update premises and active visit
      if (data.premisesId) {
        await tx.premises.update({
          where: { id: data.premisesId },
          data: { currentStatus: PremisesStatus.PARTNER_ONBOARDED }
        });

        // Mark active visit as PARTNER_ONBOARDED
        await tx.premisesVisit.updateMany({
          where: {
            premisesId: data.premisesId,
            salespersonId,
            status: VisitStatus.IN_PROGRESS
          },
          data: {
            status: VisitStatus.PARTNER_ONBOARDED,
            remarks: `On-the-spot onboarded! Code: ${partnerCode}`
          }
        });
      }

      return newPartner;
    });

    return partner;
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
          partner: { select: { id: true, partnerCode: true, businessName: true } },
          admission: {
            select: {
              admissionCode: true,
              finalFee: true,
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
      mobile: l.mobile.replace(/(\+91\d{2})\d{4}(\d{4})/, '$1****$2')
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

