import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateAccessToken, generateRefreshTokenString, hashToken } from '../utils/jwt';
import { AuthenticatedUser, JwtUserPayload, Role } from '../shared';
import { logger } from '../config/logger';

export class AuthService {
  /**
   * Authenticate user with Email and Password
   */
  async login(email: string, passwordPlain: string, ipAddress?: string, userAgent?: string) {
    const user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        deletedAt: null
      },
      include: {
        partnerProfile: {
          select: { id: true, partnerCode: true, status: true }
        }
      }
    });

    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact an administrator.', 403, 'ACCOUNT_DEACTIVATED');
    }

    const isMatch = await verifyPassword(passwordPlain, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Determine Partner ID if role is PARTNER
    const partnerId = user.partnerProfile?.id;

    // Issue JWT Access Token (15m)
    const tokenPayload: JwtUserPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as Role,
      partnerId
    };
    const accessToken = generateAccessToken(tokenPayload);

    // Issue Cryptographic Refresh Token (7 days)
    const refreshTokenPlain = generateRefreshTokenString();
    const tokenHash = hashToken(refreshTokenPlain);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt
      }
    });

    // Update last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Audit log
    logger.info(`User logged in: ${user.email} (${user.role}) [IP: ${ipAddress || 'unknown'}]`);

    const sanitizedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role as Role,
      isActive: user.isActive,
      avatarUrl: user.avatarUrl,
      partnerId
    };

    return {
      user: sanitizedUser,
      accessToken,
      refreshToken: refreshTokenPlain
    };
  }

  /**
   * Rotate Refresh Token and return a fresh Access Token
   */
  async refreshSession(refreshTokenPlain: string) {
    if (!refreshTokenPlain) {
      throw new AppError('Refresh token is required', 401, 'UNAUTHORIZED');
    }

    const tokenHash = hashToken(refreshTokenPlain);

    const existingToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            partnerProfile: { select: { id: true, partnerCode: true } }
          }
        }
      }
    });

    if (!existingToken) {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_TOKEN');
    }

    // Replay attack detection: if token is already revoked, compromise detected!
    if (existingToken.isRevoked) {
      logger.warn(`Security Warning: Refresh token replay attack detected for User ID ${existingToken.userId}! Revoking all user sessions.`);
      await prisma.refreshToken.updateMany({
        where: { userId: existingToken.userId },
        data: { isRevoked: true }
      });
      throw new AppError('Session invalidated due to suspicious activity. Please log in again.', 401, 'TOKEN_REUSED');
    }

    // Check expiration
    if (new Date() > existingToken.expiresAt) {
      throw new AppError('Refresh token expired. Please log in again.', 401, 'TOKEN_EXPIRED');
    }

    const { user } = existingToken;

    if (!user.isActive || user.deletedAt) {
      throw new AppError('User account is inactive or deleted', 403, 'ACCOUNT_INACTIVE');
    }

    // Generate new token pair (Token Rotation)
    const newRefreshTokenPlain = generateRefreshTokenString();
    const newTokenHash = hashToken(newRefreshTokenPlain);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Atomically revoke old token and insert new token
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: {
          isRevoked: true,
          replacedBy: newTokenHash
        }
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt
        }
      })
    ]);

    const partnerId = user.partnerProfile?.id;
    const tokenPayload: JwtUserPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as Role,
      partnerId
    };
    const newAccessToken = generateAccessToken(tokenPayload);

    const sanitizedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role as Role,
      isActive: user.isActive,
      avatarUrl: user.avatarUrl,
      partnerId
    };

    return {
      user: sanitizedUser,
      accessToken: newAccessToken,
      refreshToken: newRefreshTokenPlain
    };
  }

  /**
   * Invalidate active session on logout
   */
  async logout(refreshTokenPlain?: string) {
    if (refreshTokenPlain) {
      const tokenHash = hashToken(refreshTokenPlain);
      await prisma.refreshToken.updateMany({
        where: { tokenHash },
        data: { isRevoked: true }
      });
    }
  }

  /**
   * Fetch current authenticated user profile
   */
  async getCurrentUser(userId: string): Promise<AuthenticatedUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        partnerProfile: { select: { id: true, partnerCode: true, status: true } }
      }
    });

    if (!user || user.deletedAt) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role as Role,
      isActive: user.isActive,
      avatarUrl: user.avatarUrl,
      partnerId: user.partnerProfile?.id
    };
  }

  /**
   * Change Password and revoke all other existing sessions
   */
  async changePassword(userId: string, currentPasswordPlain: string, newPasswordPlain: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const isMatch = await verifyPassword(currentPasswordPlain, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Incorrect current password', 400, 'INCORRECT_PASSWORD');
    }

    const newHash = await hashPassword(newPasswordPlain);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash }
      }),
      // Revoke all existing sessions for this user
      prisma.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true }
      })
    ]);

    logger.info(`Password successfully changed for user: ${user.email}. All sessions revoked.`);
  }
}

export const authService = new AuthService();

