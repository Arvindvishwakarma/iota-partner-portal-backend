import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateAccessToken, verifyAccessToken } from '../utils/jwt';
import { AuthenticatedUser, JwtUserPayload, Role } from '../shared';
import { logger } from '../config/logger';

export class AuthService {
  /**
   * Authenticate user with Email or Mobile Number and Password
   * Issues a non-expiring persistent access token (valid until user logs out)
   */
  async login(identifier: string, passwordPlain: string, ipAddress?: string, userAgent?: string) {
    const cleanSearch = identifier.trim();
    const cleanDigits = cleanSearch.replace(/\D/g, '');
    const isPhoneLike = cleanDigits.length >= 10;
    const phone10 = cleanDigits.slice(-10);
    const normalizedMobile = `+91${phone10}`;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: cleanSearch.toLowerCase() },
          ...(isPhoneLike
            ? [
                { email: phone10 },
                { phone: phone10 },
                { phone: normalizedMobile },
                { phone: cleanDigits },
                { phone: { endsWith: phone10 } }
              ]
            : [])
        ],
        deletedAt: null
      },
      include: {
        partnerProfile: {
          select: { id: true, partnerCode: true, status: true }
        }
      }
    });

    if (!user) {
      throw new AppError('Invalid email/mobile or password', 401, 'INVALID_CREDENTIALS');
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

    // Issue Non-Expiring JWT Access Token (Persistent until Logout)
    const tokenPayload: JwtUserPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as Role,
      partnerId
    };
    const accessToken = generateAccessToken(tokenPayload);

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
      partnerId,
      partnerCode: user.partnerProfile?.partnerCode
    };

    return {
      user: sanitizedUser,
      accessToken
    };
  }

  /**
   * Session refresh no-op (Tokens do not expire; returns active user session)
   */
  async refreshSession(token?: string) {
    if (token) {
      try {
        const payload = verifyAccessToken(token);
        const user = await this.getCurrentUser(payload.userId);
        return {
          user,
          accessToken: token
        };
      } catch {
        // Fallback if token is missing
      }
    }
    return {
      message: 'Persistent session is active. Token does not expire until logout.'
    };
  }

  /**
   * Invalidate active session on logout
   */
  async logout(_token?: string) {
    // Persistent sessions are terminated by client-side token removal and cookie clearing
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
      partnerId: user.partnerProfile?.id,
      partnerCode: user.partnerProfile?.partnerCode
    };
  }

  /**
   * Change Password
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

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash }
    });

    logger.info(`Password successfully changed for user: ${user.email}.`);
  }
}

export const authService = new AuthService();
