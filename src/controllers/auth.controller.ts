import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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

      // Set Refresh Token in secure HTTP-only cookie
      res.cookie('refresh_token', result.refreshToken, COOKIE_OPTIONS);

      // Also set access_token cookie for browser clients
      res.cookie('access_token', result.accessToken, {
        ...COOKIE_OPTIONS,
        maxAge: 15 * 60 * 1000 // 15 mins
      });

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
      const refreshToken = req.cookies?.refresh_token || req.body?.refreshToken;

      const result = await authService.refreshSession(refreshToken);

      res.cookie('refresh_token', result.refreshToken, COOKIE_OPTIONS);
      res.cookie('access_token', result.accessToken, {
        ...COOKIE_OPTIONS,
        maxAge: 15 * 60 * 1000
      });

      return res.status(200).json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken
        },
        message: 'Session refreshed successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = req.cookies?.refresh_token || req.body?.refreshToken;

      await authService.logout(refreshToken);

      res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);
      res.clearCookie('access_token', CLEAR_COOKIE_OPTIONS);

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

      res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);
      res.clearCookie('access_token', CLEAR_COOKIE_OPTIONS);

      return res.status(200).json({
        success: true,
        data: null,
        message: 'Password changed successfully. Please log in with your new credentials.'
      });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
