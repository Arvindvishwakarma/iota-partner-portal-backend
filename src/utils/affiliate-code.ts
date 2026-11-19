import { prisma } from '../config/prisma';

/**
 * Generates an incrementing sequential Affiliate ID starting from IAA00101
 * (IAA00101, IAA00102, IAA00103, ...).
 */
export async function generateUniqueAffiliateCode(
  dbClient: any = prisma
): Promise<string> {
  // If previous test partner LN7SW7 exists, upgrade it to IAA00101
  try {
    const lnPartner = await dbClient.partner.findUnique({
      where: { partnerCode: 'LN7SW7' }
    });
    if (lnPartner) {
      const frontendBase = (process.env.FRONTEND_URL || 'https://affiliate.iotaacademy.in').replace(/\/+$/, '');
      await dbClient.partner.update({
        where: { id: lnPartner.id },
        data: {
          partnerCode: 'IAA00101',
          registrationUrl: `${frontendBase}/register/IAA00101`
        }
      });
    }
  } catch {
    // Ignore if not found
  }

  // Find all existing partners with IAA prefix
  const existingPartners = await dbClient.partner.findMany({
    where: {
      partnerCode: {
        startsWith: 'IAA'
      }
    },
    select: { partnerCode: true }
  });

  let maxSeq = 100; // Base: starting before 101, so the first code generated is IAA00101
  for (const p of existingPartners) {
    const match = (p.partnerCode || '').match(/^IAA(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  let nextSeq = maxSeq + 1;
  while (true) {
    const candidate = `IAA${nextSeq.toString().padStart(5, '0')}`;
    const existing = await dbClient.partner.findUnique({
      where: { partnerCode: candidate },
      select: { id: true }
    });
    if (!existing) {
      return candidate;
    }
    nextSeq++;
  }
}

/**
 * Determines whether a legacy code should be upgraded to the new IAA affiliate ID format.
 */
export function isLegacyProvisionalCode(code?: string | null): boolean {
  if (!code) return true;
  const upper = code.toUpperCase();
  if (upper.startsWith('TEMP') || upper.startsWith('PTR-PENDING') || upper.startsWith('PTR-')) {
    return true;
  }
  return !upper.startsWith('IAA');
}
