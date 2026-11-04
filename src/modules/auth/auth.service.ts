import { authRepository, AuthRepository } from './auth.repository';
import { OtpUtil } from '../../common/utils/otp.util';
import { TokenUtil } from '../../common/utils/token.util';
import { env } from '../../config/env.config';
import { logger } from '../../config/logger.config';
import { prisma } from '../../config/db.config';
import { UserRole } from '../../common/constants';
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors';
import {
  AuthSessionResponse,
  ClientDeviceInfo,
  OtpRequestResult,
  RoleStatusInfo,
  SwitchRoleResult,
  TokenPair,
} from './auth.types';

export class AuthService {
  constructor(private repo: AuthRepository = authRepository) {}

  /**
   * Request OTP for mobile number authentication
   */
  public async requestOtp(
    rawMobileNumber: string,
    purpose = 'AUTHENTICATION'
  ): Promise<OtpRequestResult> {
    const mobileNumber = OtpUtil.normalizeMobileNumber(rawMobileNumber);

    // 1. Cooldown & Rate Limiting Check
    const activeOtp = await this.repo.getLatestActiveOtp(mobileNumber);
    if (activeOtp) {
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - activeOtp.createdAt.getTime()) / 1000);
      const cooldownLimit = 60; // 60 seconds cooldown between requests

      if (elapsedSeconds < cooldownLimit) {
        const remainingSeconds = cooldownLimit - elapsedSeconds;
        throw new BadRequestError(
          `Please wait ${remainingSeconds} seconds before requesting a new OTP.`
        );
      }
    }

    // 2. Invalidate previous pending OTPs
    await this.repo.invalidatePendingOtps(mobileNumber);

    // 3. Generate cryptographic 6-digit OTP
    const plainOtp = OtpUtil.generateSecureOtp();
    const otpHash = OtpUtil.hashOtp(plainOtp, mobileNumber);

    // 4. Set 5-minute expiration
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // 5. Check if user already exists to link userId
    const existingUser = await this.repo.findUserByMobile(mobileNumber);

    // 6. Store in database
    await this.repo.createOtpVerification({
      mobileNumber,
      userId: existingUser?.id,
      otpHash,
      purpose,
      expiresAt,
    });

    logger.info(`[Auth OTP Request] OTP issued for mobile: ${mobileNumber}`);

    // Dev mock helper
    const isMock = env.NODE_ENV !== 'production' && env.MOCK_OTP_ENABLED;

    return {
      mobileNumber,
      expiresInSeconds: 300,
      cooldownSeconds: 60,
      message: 'OTP has been sent successfully.',
      devMockOtp: isMock ? env.DEV_DEFAULT_OTP : undefined,
    };
  }

  /**
   * Verify OTP and log in or register new user
   */
  public async verifyOtp(
    rawMobileNumber: string,
    rawOtp: string,
    deviceInfo: ClientDeviceInfo = {}
  ): Promise<AuthSessionResponse> {
    const mobileNumber = OtpUtil.normalizeMobileNumber(rawMobileNumber);

    // 1. Fetch latest active OTP
    const otpRecord = await this.repo.getLatestActiveOtp(mobileNumber);

    if (!otpRecord) {
      const latestAny = await this.repo.getLatestOtp(mobileNumber);
      if (latestAny) {
        if (latestAny.status === 'LOCKED') {
          throw new BadRequestError(
            'Maximum verification attempts exceeded. This OTP is locked. Please request a new OTP.'
          );
        }
        if (latestAny.status === 'VERIFIED') {
          throw new BadRequestError('This OTP has already been verified. Please request a new OTP.');
        }
        if (latestAny.expiresAt < new Date()) {
          throw new BadRequestError('OTP has expired. Please request a new OTP.');
        }
      }
      throw new BadRequestError('No active OTP request found for this mobile number.');
    }

    // 2. Check Expiry
    if (otpRecord.expiresAt < new Date()) {
      await this.repo.lockOtp(otpRecord.id);
      throw new BadRequestError('OTP has expired. Please request a new OTP.');
    }

    // 3. Verify Maximum Attempts
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await this.repo.lockOtp(otpRecord.id);
      throw new BadRequestError(
        'Maximum verification attempts exceeded. This OTP is locked. Please request a new OTP.'
      );
    }

    // 4. Verify Hash / Match
    const isDevMock =
      env.NODE_ENV !== 'production' &&
      env.MOCK_OTP_ENABLED &&
      OtpUtil.isMockOtp(rawOtp);

    const isHashMatch = OtpUtil.compareOtp(rawOtp, mobileNumber, otpRecord.otpHash);

    if (!isDevMock && !isHashMatch) {
      const updated = await this.repo.incrementOtpAttempts(otpRecord.id);
      const remainingAttempts = otpRecord.maxAttempts - updated.attempts;

      if (remainingAttempts <= 0) {
        await this.repo.lockOtp(otpRecord.id);
        throw new BadRequestError(
          'Incorrect OTP. Maximum attempts exceeded. This OTP is now locked. Please request a new OTP.'
        );
      }

      throw new BadRequestError(
        `Invalid OTP. You have ${remainingAttempts} attempt(s) remaining.`
      );
    }

    // 5. Mark OTP verified atomically
    const marked = await this.repo.markOtpVerifiedAtomic(otpRecord.id);
    if (!marked) {
      throw new BadRequestError('This OTP has already been verified or is no longer active.');
    }

    // 6. User Account Resolution (Existing or New User Registration)
    let isNewUser = false;
    let user = await this.repo.findUserByMobile(mobileNumber);

    if (user) {
      isNewUser = false;
      // Check account status
      if (user.accountStatus !== 'ACTIVE') {
        throw new ForbiddenError(
          `Account is ${user.accountStatus.toLowerCase()}. Access denied. Please contact platform support.`
        );
      }

      if (!user.isMobileVerified) {
        await this.repo.markUserMobileVerified(user.id);
      }
    } else {
      isNewUser = true;
      // New user registration: Automatically assigned CUSTOMER role
      logger.info(`[Auth Registration] Registering new customer for mobile: ${mobileNumber}`);
      user = await this.repo.createUserWithCustomerRole(mobileNumber);
    }

    // 7. Load User with assigned roles
    const userWithRoles = await this.repo.findUserById(user.id);
    if (!userWithRoles) {
      throw new NotFoundError('User account could not be retrieved.');
    }

    const assignedRoles = userWithRoles.userRoles.map((ur) => ur.role.roleName);

    // 8. Session & Token Generation (defaulting to CUSTOMER context)
    const sessionResult = await this.issueSessionTokens(
      user.id,
      mobileNumber,
      assignedRoles,
      deviceInfo,
      UserRole.CUSTOMER
    );

    return {
      isNewUser,
      user: {
        id: user.id.toString(),
        mobileNumber: user.mobileNumber,
        email: user.email,
        accountStatus: user.accountStatus,
        isMobileVerified: user.isMobileVerified,
        activeRole: sessionResult.activeRole,
        roles: assignedRoles,
        createdAt: user.createdAt.toISOString(),
      },
      tokens: sessionResult.tokens,
    };
  }

  /**
   * Refresh JWT access token with Refresh Token Rotation and Reuse Breach Detection
   */
  public async refreshTokens(
    rawRefreshToken: string,
    deviceInfo: ClientDeviceInfo = {},
    requestedActiveRole?: string
  ): Promise<AuthSessionResponse> {
    const tokenHash = TokenUtil.hashToken(rawRefreshToken);

    // 1. Lookup session
    const session = await this.repo.findSessionByTokenHash(tokenHash);

    if (!session) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    // 2. Breach / Token Reuse Detection
    if (session.revokedAt !== null) {
      logger.error(
        `[SECURITY ALERT] Revoked refresh token reuse detected for User ID: ${session.userId}! Revoking all sessions.`
      );
      await this.repo.revokeAllUserSessions(session.userId);
      throw new UnauthorizedError(
        'Security breach detected: Refresh token reuse attempt. All active sessions have been terminated. Please log in again.'
      );
    }

    // 3. Expiration Check
    if (session.expiresAt < new Date()) {
      await this.repo.revokeSession(session.id);
      throw new UnauthorizedError('Refresh token has expired. Please log in again.');
    }

    // 4. Fetch User and verify status
    const user = await this.repo.findUserById(session.userId);
    if (!user) {
      throw new UnauthorizedError('User associated with session not found.');
    }

    if (user.accountStatus !== 'ACTIVE') {
      await this.repo.revokeAllUserSessions(user.id);
      throw new ForbiddenError('Account is not active.');
    }

    // Reload fresh assigned roles from database
    const assignedRoles = user.userRoles.map((ur) => ur.role.roleName);

    if (assignedRoles.length === 0) {
      await this.repo.revokeSession(session.id);
      throw new ForbiddenError('Account has no assigned roles. Please contact support.');
    }

    // Mandatory Rule D: Active role resolution during refresh:
    // - Preserve requestedActiveRole if it is still assigned.
    // - If revoked / absent, fall back safely to CUSTOMER only when CUSTOMER is assigned.
    // - Otherwise reject refresh or require safe reauthentication.
    let resolvedActiveRole: string;
    if (requestedActiveRole && assignedRoles.includes(requestedActiveRole)) {
      resolvedActiveRole = requestedActiveRole;
    } else if (assignedRoles.includes(UserRole.CUSTOMER)) {
      resolvedActiveRole = UserRole.CUSTOMER;
    } else {
      if (assignedRoles.length === 1) {
        resolvedActiveRole = assignedRoles[0];
      } else {
        throw new UnauthorizedError(
          'Active role context revoked or unavailable. Please re-authenticate to select a valid active role.'
        );
      }
    }

    // 5. Rotate Token: Generate new Refresh Token and update session
    const newRefreshToken = TokenUtil.generateRefreshToken();
    const newRefreshTokenHash = TokenUtil.hashToken(newRefreshToken);
    const newExpiresAt = TokenUtil.calculateExpiryDate(env.REFRESH_TOKEN_EXPIRY);

    const rotatedSession = await this.repo.rotateSession(
      session.id,
      newRefreshTokenHash,
      newExpiresAt,
      deviceInfo
    );

    // 6. Generate new Access Token with activeRole
    const accessToken = TokenUtil.generateAccessToken({
      userId: user.id.toString(),
      mobileNumber: user.mobileNumber,
      roles: assignedRoles,
      activeRole: resolvedActiveRole,
      sessionId: rotatedSession.id.toString(),
    });

    return {
      isNewUser: false,
      user: {
        id: user.id.toString(),
        mobileNumber: user.mobileNumber,
        email: user.email,
        accountStatus: user.accountStatus,
        isMobileVerified: user.isMobileVerified,
        activeRole: resolvedActiveRole,
        roles: assignedRoles,
        createdAt: user.createdAt.toISOString(),
      },
      tokens: {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: env.ACCESS_TOKEN_EXPIRY,
        tokenType: 'Bearer',
      },
    };
  }

  /**
   * Switch Active Role Context
   * Validates role entitlement, checks operational status, and issues a freshly signed token.
   */
  public async switchRole(
    userIdStr: string,
    sessionIdStr: string,
    targetRoleRaw: string
  ): Promise<SwitchRoleResult> {
    const userId = BigInt(userIdStr);
    const targetRole = targetRoleRaw ? targetRoleRaw.trim().toUpperCase() : '';

    const validRoles = Object.values(UserRole) as string[];
    if (!validRoles.includes(targetRole)) {
      throw new BadRequestError(
        `Invalid role name: '${targetRoleRaw}'. Allowed roles are: ${validRoles.join(', ')}.`
      );
    }

    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User account not found.');
    }

    if (user.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError(`Account is ${user.accountStatus.toLowerCase()}. Access denied.`);
    }

    const assignedRoles = user.userRoles.map((ur) => ur.role.roleName);
    if (!assignedRoles.includes(targetRole)) {
      throw new ForbiddenError(
        `Access forbidden: Role '${targetRole}' is not assigned to your account.`
      );
    }

    // Role operational status determination
    const roleStatus = await this.getRoleOperationalStatus(userId, user.accountStatus, targetRole);

    // Issue newly signed access token containing activeRole
    const accessToken = TokenUtil.generateAccessToken({
      userId: user.id.toString(),
      mobileNumber: user.mobileNumber,
      roles: assignedRoles,
      activeRole: targetRole,
      sessionId: sessionIdStr,
    });

    logger.info(`[Auth Role Switch] User ${userIdStr} switched active context to ${targetRole}`);

    return {
      activeRole: targetRole,
      availableRoles: assignedRoles,
      roleStatus,
      tokens: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: env.ACCESS_TOKEN_EXPIRY,
      },
    };
  }

  /**
   * Internal helper to determine operational readiness of a role for a user
   */
  public async getRoleOperationalStatus(
    userId: bigint,
    userAccountStatus: string,
    roleName: string
  ): Promise<RoleStatusInfo> {
    let approvalStatus: string | null = null;
    let isOperational = false;

    if (roleName === UserRole.CUSTOMER) {
      approvalStatus = userAccountStatus;
      isOperational = userAccountStatus === 'ACTIVE';
    } else if (roleName === UserRole.PARTNER) {
      const partnerProfile = await prisma.partnerProfile.findUnique({
        where: { userId },
      });
      if (partnerProfile) {
        approvalStatus = partnerProfile.approvalStatus;
        isOperational = partnerProfile.approvalStatus === 'APPROVED';
      } else {
        approvalStatus = 'UNREGISTERED';
        isOperational = false;
      }
    } else if (roleName === UserRole.DRIVER || roleName === UserRole.WORKER) {
      approvalStatus = 'NOT_ONBOARDED';
      isOperational = false;
    } else if (roleName === UserRole.ADMIN || roleName === UserRole.SUPER_ADMIN) {
      approvalStatus = 'ACTIVE';
      isOperational = true;
    }

    return {
      role: roleName,
      approvalStatus,
      isOperational,
    };
  }

  /**
   * Terminate single user session
   */
  public async logout(sessionId: string): Promise<void> {
    try {
      const parsedSessionId = BigInt(sessionId);
      await this.repo.revokeSession(parsedSessionId);
    } catch {
      // ignore invalid bigint format
    }
  }

  /**
   * Log out all active sessions for a user
   */
  public async logoutAll(userId: string): Promise<void> {
    const parsedUserId = BigInt(userId);
    await this.repo.revokeAllUserSessions(parsedUserId);
    logger.info(`[Auth Logout All] Terminated all sessions for user: ${userId}`);
  }

  /**
   * Get authenticated user profile with roles and activeRole
   */
  public async getMe(userId: string, activeRoleFromToken?: string): Promise<any> {
    const parsedUserId = BigInt(userId);
    const user = await this.repo.findUserById(parsedUserId);

    if (!user) {
      throw new NotFoundError('User profile not found.');
    }

    const assignedRoles = user.userRoles.map((ur) => ur.role.roleName);
    let activeRole = activeRoleFromToken;
    if (!activeRole || !assignedRoles.includes(activeRole)) {
      activeRole = assignedRoles.includes(UserRole.CUSTOMER) ? UserRole.CUSTOMER : assignedRoles[0];
    }

    const roleStatus = await this.getRoleOperationalStatus(user.id, user.accountStatus, activeRole);

    return {
      id: user.id.toString(),
      mobileNumber: user.mobileNumber,
      email: user.email,
      accountStatus: user.accountStatus,
      isMobileVerified: user.isMobileVerified,
      activeRole,
      roles: assignedRoles,
      roleStatus,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /**
   * Internal helper to create session and tokens
   */
  private async issueSessionTokens(
    userId: bigint,
    mobileNumber: string,
    roles: string[],
    deviceInfo: ClientDeviceInfo,
    activeRole?: string
  ): Promise<{ tokens: TokenPair; activeRole: string }> {
    const refreshToken = TokenUtil.generateRefreshToken();
    const refreshTokenHash = TokenUtil.hashToken(refreshToken);
    const expiresAt = TokenUtil.calculateExpiryDate(env.REFRESH_TOKEN_EXPIRY);

    let resolvedActiveRole = activeRole;
    if (!resolvedActiveRole || !roles.includes(resolvedActiveRole)) {
      resolvedActiveRole = roles.includes(UserRole.CUSTOMER) ? UserRole.CUSTOMER : roles[0];
    }

    // Save session in database
    const session = await this.repo.createSession({
      userId,
      refreshTokenHash,
      deviceId: deviceInfo.deviceId,
      deviceName: deviceInfo.deviceName,
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.userAgent,
      expiresAt,
    });

    // Generate JWT access token with both roles and activeRole
    const accessToken = TokenUtil.generateAccessToken({
      userId: userId.toString(),
      mobileNumber,
      roles,
      activeRole: resolvedActiveRole,
      sessionId: session.id.toString(),
    });

    return {
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: env.ACCESS_TOKEN_EXPIRY,
        tokenType: 'Bearer',
      },
      activeRole: resolvedActiveRole,
    };
  }
}

export const authService = new AuthService();
