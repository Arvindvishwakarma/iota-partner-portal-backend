import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/environment';
import { JwtUserPayload } from '../shared';

/**
 * Generate a short-lived Access Token (15m)
 */
export function generateAccessToken(payload: JwtUserPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_EXPIRY as any
  });
}

/**
 * Verify an Access Token
 */
export function verifyAccessToken(token: string): JwtUserPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtUserPayload;
}

/**
 * Generate a cryptographically secure random Refresh Token (Hex string)
 */
export function generateRefreshTokenString(): string {
  return crypto.randomBytes(40).toString('hex');
}

/**
 * Hash a Refresh Token using SHA-256 before persisting in the database
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

