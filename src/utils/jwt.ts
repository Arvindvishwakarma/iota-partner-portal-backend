import jwt from 'jsonwebtoken';
import { env } from '../config/environment';
import { JwtUserPayload } from '../shared';

/**
 * Generate a persistent Access Token with NO expiration (valid until user logs out)
 */
export function generateAccessToken(payload: JwtUserPayload): string {
  // Signs token without expiration claim so session never expires until logout
  return jwt.sign(payload, env.JWT_ACCESS_SECRET);
}

/**
 * Verify an Access Token
 */
export function verifyAccessToken(token: string): JwtUserPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtUserPayload;
}
