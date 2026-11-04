import { prisma } from '../../config/db.config';
import { User, Role, OtpVerification, UserSession } from '@prisma/client';
import { UserRole } from '../../common/constants';

export class AuthRepository {
  /**
   * Find user by unique mobile number
   */
  public async findUserByMobile(mobileNumber: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { mobileNumber },
    });
  }

  /**
   * Find user by ID with roles
   */
  public async findUserById(userId: bigint): Promise<(User & { userRoles: { role: Role }[] }) | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });
  }

  /**
   * Find a role by its unique roleName (e.g. 'CUSTOMER', 'ADMIN')
   */
  public async findRoleByName(roleName: string): Promise<Role | null> {
    return prisma.role.findUnique({
      where: { roleName },
    });
  }

  /**
   * Atomically creates a new user, assigns default CUSTOMER role and initializes CustomerProfile
   */
  public async createUserWithCustomerRole(mobileNumber: string): Promise<User & { userRoles: { role: Role }[] }> {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch CUSTOMER role
      const customerRole = await tx.role.findUnique({
        where: { roleName: UserRole.CUSTOMER },
      });

      if (!customerRole) {
        throw new Error('Default system role CUSTOMER not found in database.');
      }

      // 2. Create User
      const user = await tx.user.create({
        data: {
          mobileNumber,
          isMobileVerified: true,
          accountStatus: 'ACTIVE',
        },
      });

      // 3. Assign UserRole
      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: customerRole.id,
        },
      });

      // 4. Initialize default CustomerProfile
      await tx.customerProfile.create({
        data: {
          userId: user.id,
          firstName: 'User',
        },
      });

      // 5. Return user with loaded roles
      const userWithRoles = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          userRoles: {
            include: { role: true },
          },
        },
      });

      return userWithRoles;
    });
  }

  /**
   * Updates user mobile verification status
   */
  public async markUserMobileVerified(userId: bigint): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { isMobileVerified: true, updatedAt: new Date() },
    });
  }

  /**
   * Invalidate all previous pending OTPs for this mobile number
   */
  public async invalidatePendingOtps(mobileNumber: string): Promise<void> {
    await prisma.otpVerification.updateMany({
      where: {
        mobileNumber,
        status: 'PENDING',
      },
      data: {
        status: 'EXPIRED',
      },
    });
  }

  /**
   * Create a new OTP verification record
   */
  public async createOtpVerification(data: {
    mobileNumber: string;
    userId?: bigint;
    otpHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<OtpVerification> {
    return prisma.otpVerification.create({
      data: {
        mobileNumber: data.mobileNumber,
        userId: data.userId || null,
        otpHash: data.otpHash,
        purpose: data.purpose,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Get the most recent active OTP for a mobile number
   */
  public async getLatestActiveOtp(mobileNumber: string): Promise<OtpVerification | null> {
    return prisma.otpVerification.findFirst({
      where: {
        mobileNumber,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get the most recent OTP regardless of status for inspection
   */
  public async getLatestOtp(mobileNumber: string): Promise<OtpVerification | null> {
    return prisma.otpVerification.findFirst({
      where: { mobileNumber },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Increment attempt counter on an OTP
   */
  public async incrementOtpAttempts(id: bigint): Promise<OtpVerification> {
    return prisma.otpVerification.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
      },
    });
  }

  /**
   * Atomically mark OTP as VERIFIED if it is currently PENDING (prevents race conditions)
   */
  public async markOtpVerifiedAtomic(id: bigint): Promise<boolean> {
    const result = await prisma.otpVerification.updateMany({
      where: {
        id,
        status: 'PENDING',
      },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  /**
   * Mark OTP as VERIFIED
   */
  public async markOtpVerified(id: bigint): Promise<void> {
    await prisma.otpVerification.update({
      where: { id },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });
  }

  /**
   * Lock OTP after maximum failed attempts
   */
  public async lockOtp(id: bigint): Promise<void> {
    await prisma.otpVerification.update({
      where: { id },
      data: {
        status: 'LOCKED',
      },
    });
  }

  /**
   * Create a new user session with hashed refresh token
   */
  public async createSession(data: {
    userId: bigint;
    refreshTokenHash: string;
    deviceId?: string;
    deviceName?: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
  }): Promise<UserSession> {
    return prisma.userSession.create({
      data: {
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        deviceId: data.deviceId || null,
        deviceName: data.deviceName || null,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Find session by refresh token hash
   */
  public async findSessionByTokenHash(refreshTokenHash: string): Promise<UserSession | null> {
    return prisma.userSession.findUnique({
      where: { refreshTokenHash },
    });
  }

  /**
   * Rotate session: marks old session revoked (preserving hash for reuse detection)
   * and creates a new active session
   */
  public async rotateSession(
    sessionId: bigint,
    newHash: string,
    newExpiry: Date,
    deviceInfo?: { ipAddress?: string; userAgent?: string }
  ): Promise<UserSession> {
    return prisma.$transaction(async (tx) => {
      const oldSession = await tx.userSession.update({
        where: { id: sessionId },
        data: {
          revokedAt: new Date(),
          lastUsedAt: new Date(),
        },
      });

      return tx.userSession.create({
        data: {
          userId: oldSession.userId,
          refreshTokenHash: newHash,
          deviceId: oldSession.deviceId,
          deviceName: oldSession.deviceName,
          ipAddress: deviceInfo?.ipAddress || oldSession.ipAddress,
          userAgent: deviceInfo?.userAgent || oldSession.userAgent,
          expiresAt: newExpiry,
        },
      });
    });
  }

  /**
   * Revoke a specific session (single logout)
   */
  public async revokeSession(sessionId: bigint): Promise<void> {
    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Revoke all active sessions for a user (logout all / reuse breach detection)
   */
  public async revokeAllUserSessions(userId: bigint): Promise<void> {
    await prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Count active sessions for a user
   */
  public async countActiveSessions(userId: bigint): Promise<number> {
    return prisma.userSession.count({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }
}

export const authRepository = new AuthRepository();
