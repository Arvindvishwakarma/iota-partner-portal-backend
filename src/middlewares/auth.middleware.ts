import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';
import { verifyAccessToken } from '../utils/jwt';
import { JwtUserPayload, Role } from '../shared';

export interface AuthenticatedRequest extends Request {
  user?: JwtUserPayload;
  correlationId?: string;
}

/**
 * Middleware to authenticate requests via Bearer JWT token or access_token cookie
 */
export const authenticateJwt = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  let token: string | undefined;

  // 1. Check Authorization Header: "Bearer <token>"
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.access_token) {
    // 2. Fallback to HttpOnly cookie
    token = req.cookies.access_token;
  }

  if (!token) {
    return next(new AppError('Authentication required. Missing token.', 401, 'UNAUTHORIZED'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Access token has expired. Please refresh your session.', 401, 'TOKEN_EXPIRED'));
    }
    return next(new AppError('Invalid authentication token.', 401, 'INVALID_TOKEN'));
  }
};

/**
 * Role-Based Access Control (RBAC) Guard Middleware
 */
export const requireRole = (allowedRoles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          `Access forbidden. Role '${req.user.role}' is not authorized for this resource.`,
          403,
          'FORBIDDEN'
        )
      );
    }

    next();
  };
};

