import { prisma } from '../config/prisma';

/**
 * Generates an incrementing sequential Affiliate ID starting from IAA00101
 * (IAA00101, IAA00102, IAA00103, ...).
 */
export async function generateUniqueAffiliateCode(
  dbClient: any = prisma
): Promise<string> {
  const existingAffiliates = await dbClient.affiliate.findMany({
    where: {
      affiliateCode: {
        startsWith: 'IAA'
      }
    },
    select: { affiliateCode: true }
  });

  let maxSeq = 100; // Base: starting before 101, so the first code generated is IAA00101
  for (const a of existingAffiliates) {
    const match = (a.affiliateCode || '').match(/^IAA(\d+)$/i);
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
    const existing = await dbClient.affiliate.findUnique({
      where: { affiliateCode: candidate },
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
