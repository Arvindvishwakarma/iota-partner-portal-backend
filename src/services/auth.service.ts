import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateAccessToken, verifyAccessToken } from '../utils/jwt';
import { buildAuthenticatedUser } from '../utils/user-display';
import { AuthenticatedUser, JwtUserPayload, Role } from '../shared';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import { emailOtpService } from './email-otp.service';
import { whatsappOtpService } from './whatsapp-otp.service';

type ResetChannel = 'email' | 'whatsapp';

export class AuthService {
  private readonly RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
  private consumedResetTokenIds = new Map<string, number>();

  private cleanupConsumedResetTokens() {
    const now = Date.now();
    for (const [jti, exp] of this.consumedResetTokenIds.entries()) {
      if (exp < now) this.consumedResetTokenIds.delete(jti);
    }
  }

  private getResetSecret(): string {
    return `${env.JWT_ACCESS_SECRET || 'iota_reset_fallback_2026'}:password-reset`;
  }

  private issuePasswordResetToken(userId: string, channel: ResetChannel): string {
    this.cleanupConsumedResetTokens();
    const ts = Date.now();
    const jti = crypto.randomBytes(12).toString('hex');
    const payload = `${userId}:${channel}:${ts}:${jti}`;
    const sig = crypto.createHmac('sha256', this.getResetSecret()).update(payload).digest('hex');
    return Buffer.from(`${payload}:${sig}`).toString('base64');
  }

  private consumePasswordResetToken(token: string, expectedUserId: string, channel: ResetChannel): void {
    this.cleanupConsumedResetTokens();
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length !== 5) {
        throw new AppError('Invalid or expired password reset session. Please verify again.', 400, 'INVALID_RESET_TOKEN');
      }
      const [userId, tokenChannel, tsStr, jti, sig] = parts;
      if (userId !== expectedUserId || tokenChannel !== channel) {
        throw new AppError('Reset verification does not match this account.', 400, 'RESET_TOKEN_MISMATCH');
      }
      if (this.consumedResetTokenIds.has(jti)) {
        throw new AppError('This password reset session has already been used.', 400, 'RESET_TOKEN_USED');
      }
      const ts = parseInt(tsStr, 10);
      if (isNaN(ts) || Date.now() - ts > this.RESET_TOKEN_TTL_MS) {
        throw new AppError('Your password reset session has expired. Please verify again.', 400, 'RESET_TOKEN_EXPIRED');
      }
      const expectedSig = crypto
        .createHmac('sha256', this.getResetSecret())
        .update(`${userId}:${tokenChannel}:${tsStr}:${jti}`)
        .digest('hex');
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new AppError('Invalid password reset verification token.', 400, 'INVALID_RESET_TOKEN');
      }
      this.consumedResetTokenIds.set(jti, Date.now() + this.RESET_TOKEN_TTL_MS);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('Invalid or expired password reset verification.', 400, 'INVALID_RESET_TOKEN');
    }
  }

  private async findActiveUserByEmail(rawEmail: string) {
    const cleanEmail = emailOtpService.normalizeEmail(rawEmail);
    const user = await prisma.user.findFirst({
      where: {
        emailAddress: { equals: cleanEmail, mode: 'insensitive' },
        deletedAt: null
      }
    });
    if (!user) {
      throw new AppError('No account found with this registered email address.', 404, 'ACCOUNT_NOT_FOUND');
    }
    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact support.', 403, 'ACCOUNT_DEACTIVATED');
    }
    return user;
  }

  private async findActiveUserByPhone(rawMobile: string) {
    const phone10 = whatsappOtpService.normalizePhone(rawMobile);
    if (!/^[6-9]\d{9}$/.test(phone10)) {
      throw new AppError('Please enter a valid 10-digit WhatsApp / mobile number.', 400, 'INVALID_PHONE');
    }
    const normalizedMobile = `+91${phone10}`;
    const user = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { mobileNumber: phone10 },
          { mobileNumber: normalizedMobile },
          { mobileNumber: `91${phone10}` },
          { mobileNumber: { endsWith: phone10 } },
          {
            affiliateProfile: {
              is: {
                OR: [
                  { mobileNumber: phone10 },
                  { mobileNumber: normalizedMobile },
                  { mobileNumber: { endsWith: phone10 } },
                  { whatsappNumber: phone10 },
                  { whatsappNumber: normalizedMobile },
                  { whatsappNumber: { endsWith: phone10 } }
                ]
              }
            }
          }
        ]
      }
    });
    if (!user) {
      throw new AppError('No account found with this WhatsApp / mobile number.', 404, 'ACCOUNT_NOT_FOUND');
    }
    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact support.', 403, 'ACCOUNT_DEACTIVATED');
    }
    return { user, phone10 };
  }
  /**
   * Authenticate user with Email or Mobile Number and Password
   * Issues a non-expiring persistent access token (valid until user logs out)
   */
  async login(identifier: string, passwordPlain: string, ipAddress?: string, _userAgent?: string) {
    const cleanSearch = identifier.trim();
    const cleanDigits = cleanSearch.replace(/\D/g, '');
    const isPhoneLike = cleanDigits.length >= 10;
    const phone10 = cleanDigits.slice(-10);
    const normalizedMobile = `+91${phone10}`;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { emailAddress: { equals: cleanSearch.toLowerCase(), mode: 'insensitive' } },
          ...(isPhoneLike
            ? [
                { emailAddress: phone10 },
                { mobileNumber: phone10 },
                { mobileNumber: normalizedMobile },
                { mobileNumber: cleanDigits },
                { mobileNumber: { endsWith: phone10 } }
              ]
            : [])
        ],
        deletedAt: null
      },
      include: {
        affiliateProfile: {
          select: { id: true, affiliateCode: true, status: true, rejectionReason: true }
        }
      }
    });

    if (!user) {
      throw new AppError('Invalid email/mobile or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact an administrator.', 403, 'ACCOUNT_DEACTIVATED');
    }

    const isMatch = await verifyPassword(passwordPlain, user.password);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const partnerId = user.affiliateProfile?.id;

    const tokenPayload: JwtUserPayload = {
      userId: user.id,
      email: user.emailAddress,
      role: user.role as Role,
      partnerId
    };
    const accessToken = generateAccessToken(tokenPayload);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    logger.info(`User logged in: ${user.emailAddress} (${user.role}) [IP: ${ipAddress || 'unknown'}]`);

    const sanitizedUser = buildAuthenticatedUser(user, user.affiliateProfile);

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
        affiliateProfile: {
          select: { id: true, affiliateCode: true, status: true, rejectionReason: true }
        }
      }
    });

    if (!user || user.deletedAt) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    return buildAuthenticatedUser(user, user.affiliateProfile);
  }

  /**
   * Change Password
   */
  async changePassword(userId: string, currentPasswordPlain: string, newPasswordPlain: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const isMatch = await verifyPassword(currentPasswordPlain, user.password);
    if (!isMatch) {
      throw new AppError('Incorrect current password', 400, 'INCORRECT_PASSWORD');
    }

    const newHash = await hashPassword(newPasswordPlain);

    await prisma.user.update({
      where: { id: userId },
      data: { password: newHash }
    });

    logger.info(`Password successfully changed for user: ${user.emailAddress}.`);
  }

  /**
   * Forgot Password (Email): verify email matches an active account, then send 6-digit verification code
   */
  async forgotPasswordSendEmailCode(email: string) {
    const user = await this.findActiveUserByEmail(email);
    const otpResult = await emailOtpService.sendOtp(user.emailAddress, {
      title: 'IOTA Academy Password Reset Code',
      heading: 'Reset Your Password',
      description:
        'We received a request to reset your IOTA Academy Affiliate Program password. Enter the 6-digit verification code below to proceed:',
      subject: 'Password Reset Verification Code - IOTA Academy'
    });

    return {
      cooldown: otpResult.cooldown,
      expiresInSeconds: otpResult.expiresInSeconds
    };
  }

  /**
   * Forgot Password (Email): verify 6-digit email code and return single-use reset token
   */
  async forgotPasswordVerifyEmailCode(email: string, code: string) {
    const user = await this.findActiveUserByEmail(email);
    await emailOtpService.verifyOtp(user.emailAddress, code);
    const resetToken = this.issuePasswordResetToken(user.id, 'email');
    return { resetToken };
  }

  /**
   * Forgot Password (Email): apply new password using verified reset token
   */
  async forgotPasswordResetByEmail(email: string, resetToken: string, newPasswordPlain: string) {
    const user = await this.findActiveUserByEmail(email);
    this.consumePasswordResetToken(resetToken, user.id, 'email');

    const newHash = await hashPassword(newPasswordPlain);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: newHash }
    });

    logger.info(`Password reset via Email code completed for user: ${user.emailAddress}.`);
  }

  /**
   * Forgot Password (WhatsApp): verify mobile matches an active account, then dispatch WhatsApp OTP
   */
  async forgotPasswordSendWhatsappOtp(mobile: string) {
    const { phone10 } = await this.findActiveUserByPhone(mobile);
    const otpSessionId = `fp-wa-${crypto.randomBytes(10).toString('hex')}`;
    const result = await whatsappOtpService.sendOtp(phone10, otpSessionId);

    return {
      otpSessionId,
      cooldown: result.cooldown,
      expiresInSeconds: result.expiresInSeconds
    };
  }

  /**
   * Forgot Password (WhatsApp): verify WhatsApp OTP and return single-use reset token
   */
  async forgotPasswordVerifyWhatsappOtp(mobile: string, otp: string, otpSessionId?: string) {
    const { user, phone10 } = await this.findActiveUserByPhone(mobile);
    const verified = await whatsappOtpService.verifyOtp(phone10, otp, otpSessionId);
    whatsappOtpService.consumePhoneVerification(phone10, verified.verificationToken, otpSessionId);
    const resetToken = this.issuePasswordResetToken(user.id, 'whatsapp');
    return { resetToken };
  }

  /**
   * Forgot Password (WhatsApp): apply new password using verified reset token
   */
  async forgotPasswordResetByWhatsapp(mobile: string, resetToken: string, newPasswordPlain: string) {
    const { user } = await this.findActiveUserByPhone(mobile);
    this.consumePasswordResetToken(resetToken, user.id, 'whatsapp');

    const newHash = await hashPassword(newPasswordPlain);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: newHash }
    });

    logger.info(`Password reset via WhatsApp OTP completed for user: ${user.emailAddress}.`);
  }
}

export const authService = new AuthService();
