import { Request, Response, NextFunction } from 'express';
import { authService, AuthService } from './auth.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class AuthController {
  constructor(private service: AuthService = authService) {}

  /**
   * Request OTP
   * POST /api/v1/auth/otp/request
   */
  public requestOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mobileNumber, purpose } = req.body;
      const result = await this.service.requestOtp(mobileNumber, purpose);

      ApiResponse.success(res, result, result.message, 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Verify OTP and Login / Register
   * POST /api/v1/auth/otp/verify
   */
  public verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mobileNumber, otp, deviceId, deviceName } = req.body;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || undefined;
      const userAgent = req.headers['user-agent'];

      const result = await this.service.verifyOtp(mobileNumber, otp, {
        deviceId,
        deviceName,
        ipAddress: ipAddress ? ipAddress.split(',')[0].trim() : undefined,
        userAgent,
      });

      ApiResponse.success(res, result, 'Authentication successful', 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Refresh Tokens with Rotation and Active Role context preservation
   * POST /api/v1/auth/refresh
   */
  public refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken, activeRole } = req.body;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || undefined;
      const userAgent = req.headers['user-agent'];

      const result = await this.service.refreshTokens(
        refreshToken,
        {
          ipAddress: ipAddress ? ipAddress.split(',')[0].trim() : undefined,
          userAgent,
        },
        activeRole
      );

      ApiResponse.success(res, result, 'Tokens refreshed successfully', 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Switch Active Role Context
   * POST /api/v1/auth/switch-role
   */
  public switchRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const sessionId = req.user!.sessionId;
      const { role } = req.body;

      const result = await this.service.switchRole(userId, sessionId, role);

      ApiResponse.success(
        res,
        result,
        `Switched to ${result.activeRole} context successfully.`,
        200
      );
    } catch (error) {
      next(error);
    }
  };

  /**
   * Single-device Logout
   * POST /api/v1/auth/logout
   */
  public logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = req.user?.sessionId;

      if (sessionId) {
        await this.service.logout(sessionId);
      }

      ApiResponse.success(res, null, 'Logged out successfully', 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Logout from all devices
   * POST /api/v1/auth/logout-all
   */
  public logoutAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;

      if (userId) {
        await this.service.logoutAll(userId);
      }

      ApiResponse.success(res, null, 'Logged out from all devices successfully', 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get Current Authenticated User Profile
   * GET /api/v1/auth/me
   */
  public getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const activeRoleFromToken = req.user?.activeRole;
      const user = await this.service.getMe(userId, activeRoleFromToken);

      ApiResponse.success(res, user, 'Profile retrieved successfully', 200);
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
