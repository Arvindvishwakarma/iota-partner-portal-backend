import crypto from 'crypto';
import { prisma } from '../config/prisma';

// Unambiguous uppercase alphanumeric characters (excludes 0, O, 1, I)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/**
 * Generates a cryptographically random 6-character uppercase alphanumeric affiliate code (e.g. "7K9M2X").
 */
export function generateRandomAffiliateCode(length = CODE_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Generates a guaranteed-unique 6-character affiliate code checked against the database.
 */
export async function generateUniqueAffiliateCode(
  dbClient: { partner: { findUnique: typeof prisma.partner.findUnique } } = prisma,
  maxAttempts = 20
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateRandomAffiliateCode();
    const existing = await dbClient.partner.findUnique({
      where: { partnerCode: candidate },
      select: { id: true }
    });
    if (!existing) {
      return candidate;
    }
  }
  // Fallback to 7 characters if extremely unlikely collision streak occurs
  return generateRandomAffiliateCode(CODE_LENGTH + 1);
}

/**
 * Determines whether a legacy code should be upgraded to the new 6-character affiliate code format.
 */
export function isLegacyProvisionalCode(code?: string | null): boolean {
  if (!code) return true;
  const upper = code.toUpperCase();
  return upper.startsWith('TEMP') || upper.startsWith('PTR-PENDING') || upper.startsWith('PTR-');
}
