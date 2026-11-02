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

      // If status is PARTNER_ONBOARDED, ensure Partner record exists in PENDING_APPROVAL status for Super Admin review
      if (data.status === VisitStatus.PARTNER_ONBOARDED) {
        const existingPartner = await tx.partner.findUnique({
          where: { premisesId: visit!.premisesId }
        });

        if (!existingPartner) {
          const prem = await tx.premises.findUnique({
            where: { id: visit!.premisesId }
          });

          if (prem) {
            const rawPhone = prem.contactNumber.replace(/\D/g, '');
            const normalizedMobile = prem.contactNumber.startsWith('+91')
              ? prem.contactNumber
              : `+91${rawPhone}`;
            const email = `${rawPhone || prem.id.slice(0, 8)}@partner.iotaacademy.in`;

            let user = await tx.user.findFirst({
              where: { OR: [{ email }, { phone: normalizedMobile }] }
            });

            if (!user) {
              const defaultPasswordHash = await hashPassword('Partner@123456');
              user = await tx.user.create({
                data: {
                  email,
                  phone: normalizedMobile,
                  fullName: prem.premisesName,
                  passwordHash: defaultPasswordHash,
                  role: Role.PARTNER,
                  isActive: false // Inactive until Super Admin accepts approval
                }
              });
            }

            const partnerCode = `PTR-PENDING-${prem.id.substring(0, 6).toUpperCase()}`;
            const registrationUrl = `${env.FRONTEND_URL}/register/${partnerCode}`;

            await tx.partner.create({
              data: {
                userId: user.id,
                premisesId: prem.id,
                partnerCode,
                businessName: prem.premisesName,
                category: prem.category,
                ownerName: prem.premisesName,
                contactPerson: prem.premisesName,
                mobile: normalizedMobile,
                email,
                addressLine1: prem.fullAddress,
                addressLine2: null,
                city: 'General',
                area: 'General',
                pincode: '560001',
                latitude: prem.latitude,
                longitude: prem.longitude,
                registrationUrl,
                status: PartnerStatus.PENDING_APPROVAL,
                onboardedByUserId: salespersonId
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
          upiId: data.upiId || null,
          onboardingFormImage: data.onboardingFormImage || null
        }
      });

      // If an onboarding form image was provided, also record it in partner documents
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

