import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

// Persistent cookie settings (10 years - does not expire until user logs out)
const PERSISTENT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 10 * 365 * 24 * 60 * 60 * 1000 // 10 years
};

const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax'
};

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await authService.login(email, password, ipAddress, userAgent);

      // Set persistent access_token cookie for browser clients (valid until logout)
      res.cookie('access_token', result.accessToken, PERSISTENT_COOKIE_OPTIONS);

      // Clean up any old refresh_token cookie
      res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);

      return res.status(200).json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken
        },
        message: 'Login successful'
      });
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const authHeader = req.headers.authorization;
      const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.split(' ')[1] : req.cookies?.access_token;
      const result = await authService.refreshSession(token);

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Persistent session active'
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.logout();

      res.clearCookie('access_token', CLEAR_COOKIE_OPTIONS);
      res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);

      return res.status(200).json({
        success: true,
        data: null,
        message: 'Logged out successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  async me(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await authService.getCurrentUser(req.user!.userId);

      return res.status(200).json({
        success: true,
        data: user,
        message: 'Current user profile fetched successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { currentPassword, newPassword } = req.body;

      await authService.changePassword(req.user!.userId, currentPassword, newPassword);

      return res.status(200).json({
        success: true,
        data: null,
        message: 'Password changed successfully.'
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPasswordSendEmailCode(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.forgotPasswordSendEmailCode(req.body.email);
      return res.status(200).json({
        success: true,
        data: result,
        message: 'Verification code sent to your registered email address.'
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPasswordVerifyEmailCode(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.forgotPasswordVerifyEmailCode(req.body.email, req.body.code);
      return res.status(200).json({
        success: true,
        data: result,
        message: 'Email code verified successfully.'
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPasswordResetByEmail(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.forgotPasswordResetByEmail(req.body.email, req.body.resetToken, req.body.newPassword);
      return res.status(200).json({
        success: true,
        data: null,
        message: 'Password has been reset successfully. Please login with your new password.'
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPasswordSendWhatsappOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.forgotPasswordSendWhatsappOtp(req.body.mobile);
      return res.status(200).json({
        success: true,
        data: result,
        message: 'Verification OTP sent to your registered WhatsApp number.'
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPasswordVerifyWhatsappOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.forgotPasswordVerifyWhatsappOtp(
        req.body.mobile,
        req.body.otp,
        req.body.otpSessionId
      );
      return res.status(200).json({
        success: true,
        data: result,
        message: 'WhatsApp OTP verified successfully.'
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPasswordResetByWhatsapp(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.forgotPasswordResetByWhatsapp(req.body.mobile, req.body.resetToken, req.body.newPassword);
      return res.status(200).json({
        success: true,
        data: null,
        message: 'Password has been reset successfully. Please login with your new password.'
      });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
