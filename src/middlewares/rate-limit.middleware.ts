import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

/**
 * Lightweight in-memory sliding/fixed-window rate limiter middleware for public OTP and lead endpoints.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, RateLimitBucket>();

  // Periodic cleanup of expired rate-limit entries
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, Math.max(60_000, options.windowMs));
  cleanupTimer.unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';

    const customKey = options.keyGenerator ? options.keyGenerator(req) : '';
    const key = customKey ? `${ip}:${customKey}` : ip;

    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (existing.count >= options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return next(
        new AppError(
          options.message || `Too many requests. Please try again in ${retryAfterSec} seconds.`,
          429,
          'RATE_LIMIT_EXCEEDED'
        )
      );
    }

    existing.count += 1;
    return next();
  };
}
