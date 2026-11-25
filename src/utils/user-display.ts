import { Occupation as PrismaOccupation } from '@prisma/client';
import { AuthenticatedUser, AffiliateStatus, Gender, Occupation, Role } from '../shared';

const PRISMA_OCCUPATION_TO_LABEL: Record<string, Occupation> = {
  STUDENT: Occupation.STUDENT,
  INFLUENCER: Occupation.INFLUENCER,
  WORKING_PROFESSIONAL: Occupation.WORKING_PROFESSIONAL,
  EDUCATOR: Occupation.EDUCATOR,
  FREELANCER: Occupation.FREELANCER,
  CONSULTANT: Occupation.CONSULTANT,
  SELF_EMPLOYED: Occupation.SELF_EMPLOYED,
  BUSINESS_OWNER: Occupation.BUSINESS_OWNER,
  OTHER: Occupation.OTHER
};

const LABEL_TO_PRISMA_OCCUPATION: Record<string, PrismaOccupation> = {
  student: PrismaOccupation.STUDENT,
  influencer: PrismaOccupation.INFLUENCER,
  'working professional': PrismaOccupation.WORKING_PROFESSIONAL,
  working_professional: PrismaOccupation.WORKING_PROFESSIONAL,
  educator: PrismaOccupation.EDUCATOR,
  freelancer: PrismaOccupation.FREELANCER,
  consultant: PrismaOccupation.CONSULTANT,
  'self-employed': PrismaOccupation.SELF_EMPLOYED,
  self_employed: PrismaOccupation.SELF_EMPLOYED,
  'business owner': PrismaOccupation.BUSINESS_OWNER,
  business_owner: PrismaOccupation.BUSINESS_OWNER,
  other: PrismaOccupation.OTHER
};

/**
 * Converts a Prisma Occupation enum key or display string into the canonical display label.
 */
export function formatOccupationLabel(occupation?: string | null): Occupation {
  if (!occupation) return Occupation.STUDENT;
  const upper = occupation.toUpperCase();
  if (PRISMA_OCCUPATION_TO_LABEL[upper]) {
    return PRISMA_OCCUPATION_TO_LABEL[upper];
  }
  const lower = occupation.trim().toLowerCase();
  const key = LABEL_TO_PRISMA_OCCUPATION[lower];
  return key ? PRISMA_OCCUPATION_TO_LABEL[key] : Occupation.OTHER;
}

/**
 * Maps a human-readable occupation string or enum key into Prisma's Occupation enum.
 */
export function toPrismaOccupation(occupation?: string | null): PrismaOccupation {
  if (!occupation) return PrismaOccupation.STUDENT;
  const normalized = occupation.trim().toLowerCase();
  return LABEL_TO_PRISMA_OCCUPATION[normalized] || PrismaOccupation.OTHER;
}

/**
 * Formats first + last name cleanly.
 */
export function formatFullName(firstName?: string | null, lastName?: string | null): string {
  return `${firstName || ''} ${lastName || ''}`.trim();
}

/**
 * Derives a clean display/business name from an Affiliate record without storing duplicate columns.
 */
export function formatAffiliateBusinessName(affiliate: {
  firstName?: string | null;
  lastName?: string | null;
  firmName?: string | null;
  occupation?: string | null;
}): string {
  if (affiliate.firmName?.trim()) {
    return affiliate.firmName.trim();
  }
  const fullName = formatFullName(affiliate.firstName, affiliate.lastName);
  const occ = formatOccupationLabel(affiliate.occupation);
  return fullName ? `${fullName} (${occ})` : occ;
}

/**
 * Builds the canonical AuthenticatedUser payload from a User + optional Affiliate profile.
 */
export function buildAuthenticatedUser(
  user: any,
  affiliate?: any
): AuthenticatedUser {
  const fullName = formatFullName(user.firstName, user.lastName);
  const occLabel = formatOccupationLabel(user.occupation);
  const status = (affiliate?.status as AffiliateStatus) || null;
  const code = affiliate?.affiliateCode || null;

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName,
    email: user.emailAddress,
    emailAddress: user.emailAddress,
    phone: user.mobileNumber,
    mobileNumber: user.mobileNumber,
    whatsappNumber: user.whatsappNumber,
    gender: user.gender as Gender,
    age: user.age,
    occupation: occLabel,
    communicationAddress: user.communicationAddress,
    role: user.role as Role,
    isActive: user.isActive,
    avatarUrl: user.avatarUrl,
    partnerId: affiliate?.id || null,
    partnerCode: code,
    affiliateCode: code,
    partnerStatus: status,
    affiliateStatus: status,
    rejectionReason: affiliate?.rejectionReason || null
  };
}
