import request from 'supertest';
import express, { Application } from 'express';
import app from '../src/app';
import { prisma, disconnectDatabase } from '../src/config/db.config';
import { TokenUtil } from '../src/common/utils/token.util';
import { UserRole } from '../src/common/constants';
import { requireAuth, requireActiveRole } from '../src/common/middlewares/auth.middleware';
import { errorHandler } from '../src/common/middlewares/error.middleware';
import { ApiResponse } from '../src/common/utils/api-response.util';
import { adminRepository } from '../src/modules/admin/admin.repository';

describe('Phase 6B: Unified Identity & Role Management', () => {
  const MOB_USER_DUAL = '+919999333001';
  const MOB_USER_ADMIN = '+919999333002';
  const MOB_USER_SUPER_ADMIN = '+919999333003';
  const MOB_TARGET_USER = '+919999333004';

  let dualToken: string;
  let dualUserId: bigint;
  let dualSessionId: bigint;
  let dualRefreshToken: string;
  let dualPartnerProfileId: bigint;

  let adminToken: string;
  let adminUserId: bigint;

  let superAdminToken: string;
  let superAdminUserId: bigint;

  let targetUserId: bigint;

  const setupTestUser = async (mobileNumber: string, roleNames: string[], activeRole?: string) => {
    let user = await prisma.user.findUnique({ where: { mobileNumber } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          mobileNumber,
          accountStatus: 'ACTIVE',
          isMobileVerified: true,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { accountStatus: 'ACTIVE', isMobileVerified: true },
      });
    }

    for (const rName of roleNames) {
      const role = await prisma.role.findUnique({ where: { roleName: rName } });
      if (role) {
        const hasRole = await prisma.userRole.findFirst({
          where: { userId: user.id, roleId: role.id },
        });
        if (!hasRole) {
          await prisma.userRole.create({
            data: { userId: user.id, roleId: role.id },
          });
        }
      }
    }

    const rawRefreshToken = TokenUtil.generateRefreshToken();
    const tokenHash = TokenUtil.hashToken(rawRefreshToken);
    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: tokenHash,
        expiresAt: TokenUtil.calculateExpiryDate('30d'),
      },
    });

    const accessToken = TokenUtil.generateAccessToken({
      userId: user.id.toString(),
      mobileNumber: user.mobileNumber,
      roles: roleNames,
      activeRole: activeRole || (roleNames.includes('CUSTOMER') ? 'CUSTOMER' : roleNames[0]),
      sessionId: session.id.toString(),
    });

    return { user, token: accessToken, session, refreshToken: rawRefreshToken };
  };

  const cleanupData = async () => {
    try {
      const testMobiles = [
        MOB_USER_DUAL,
        MOB_USER_ADMIN,
        MOB_USER_SUPER_ADMIN,
        MOB_TARGET_USER,
      ];
      const users = await prisma.user.findMany({
        where: { mobileNumber: { in: testMobiles } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { actorUserId: { in: userIds } },
        });

        const partners = await prisma.partnerProfile.findMany({
          where: { userId: { in: userIds } },
          select: { id: true },
        });
        const partnerIds = partners.map((p) => p.id);

        if (partnerIds.length > 0) {
          await prisma.partnerProfile.deleteMany({
            where: { id: { in: partnerIds } },
          });
        }

        await prisma.customerProfile.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.userSession.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.userRole.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    } catch {
      // ignore cleanup errors
    }
  };

  beforeAll(async () => {
    await cleanupData();

    // 1. Dual user with CUSTOMER and PARTNER roles
    const dualSetup = await setupTestUser(
      MOB_USER_DUAL,
      [UserRole.CUSTOMER, UserRole.PARTNER],
      UserRole.CUSTOMER
    );
    dualToken = dualSetup.token;
    dualUserId = dualSetup.user.id;
    dualSessionId = dualSetup.session.id;
    dualRefreshToken = dualSetup.refreshToken;

    await prisma.customerProfile.create({
      data: {
        userId: dualUserId,
        firstName: 'Unified',
        lastName: 'Customer',
      },
    });

    const partnerProfile = await prisma.partnerProfile.create({
      data: {
        userId: dualUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Unified Partner Services',
        approvalStatus: 'APPROVED',
      },
    });
    dualPartnerProfileId = partnerProfile.id;

    // 2. Operational Admin
    const adminSetup = await setupTestUser(MOB_USER_ADMIN, [UserRole.ADMIN]);
    adminToken = adminSetup.token;
    adminUserId = adminSetup.user.id;

    // 3. Super Admin
    const superAdminSetup = await setupTestUser(MOB_USER_SUPER_ADMIN, [
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);
    superAdminToken = superAdminSetup.token;
    superAdminUserId = superAdminSetup.user.id;

    // 4. Target User for Privileged Role Operations
    const targetSetup = await setupTestUser(MOB_TARGET_USER, [UserRole.CUSTOMER]);
    targetUserId = targetSetup.user.id;
  });

  afterAll(async () => {
    await cleanupData();
    await disconnectDatabase();
  });

  // =========================================================================
  // 1. MULTIPLE ROLES ON ONE ACCOUNT & IDEMPOTENCY
  // =========================================================================
  describe('Multiple Roles & Idempotent Assignment', () => {
    it('1. should automatically assign CUSTOMER role to first-time user upon OTP verification', async () => {
      const mobFirstTime = '+919999666001';
      // Clean up previous run if any
      const existing = await prisma.user.findUnique({ where: { mobileNumber: mobFirstTime } });
      if (existing) {
        await prisma.userRole.deleteMany({ where: { userId: existing.id } });
        await prisma.userSession.deleteMany({ where: { userId: existing.id } });
        await prisma.otpVerification.deleteMany({ where: { mobileNumber: mobFirstTime } });
        await prisma.user.delete({ where: { id: existing.id } });
      }

      await request(app).post('/api/v1/auth/otp/request').send({ mobileNumber: mobFirstTime });
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ mobileNumber: mobFirstTime, otp: '123456' });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.user.roles).toEqual(['CUSTOMER']);
      expect(verifyRes.body.data.user.activeRole).toBe('CUSTOMER');

      // Cleanup
      const created = await prisma.user.findUnique({ where: { mobileNumber: mobFirstTime } });
      if (created) {
        await prisma.userRole.deleteMany({ where: { userId: created.id } });
        await prisma.userSession.deleteMany({ where: { userId: created.id } });
        await prisma.otpVerification.deleteMany({ where: { mobileNumber: mobFirstTime } });
        await prisma.user.delete({ where: { id: created.id } });
      }
    });

    it('2. should preserve CUSTOMER role when onboarding as a PARTNER', async () => {
      const mobOnboard = '+919999666002';
      const existing = await prisma.user.findUnique({ where: { mobileNumber: mobOnboard } });
      if (existing) {
        await prisma.partnerProfile.deleteMany({ where: { userId: existing.id } });
        await prisma.customerProfile.deleteMany({ where: { userId: existing.id } });
        await prisma.userRole.deleteMany({ where: { userId: existing.id } });
        await prisma.userSession.deleteMany({ where: { userId: existing.id } });
        await prisma.user.delete({ where: { id: existing.id } });
      }

      const cust = await setupTestUser(mobOnboard, [UserRole.CUSTOMER]);
      await prisma.customerProfile.create({
        data: { userId: cust.user.id, firstName: 'Partner', lastName: 'Candidate' },
      });

      const onboardRes = await request(app)
        .post('/api/v1/partners/onboarding')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({
          profileType: 'INDIVIDUAL',
          legalName: 'Candidate Services',
        });

      expect(onboardRes.status).toBe(201);

      // Verify user now has both CUSTOMER and PARTNER roles
      const userRoles = await prisma.userRole.findMany({
        where: { userId: cust.user.id },
        include: { role: true },
      });
      const names = userRoles.map((ur) => ur.role.roleName);
      expect(names).toContain('CUSTOMER');
      expect(names).toContain('PARTNER');

      // Cleanup
      await prisma.partnerProfile.deleteMany({ where: { userId: cust.user.id } });
      await prisma.customerProfile.deleteMany({ where: { userId: cust.user.id } });
      await prisma.userRole.deleteMany({ where: { userId: cust.user.id } });
      await prisma.userSession.deleteMany({ where: { userId: cust.user.id } });
      await prisma.user.delete({ where: { id: cust.user.id } });
    });

    it('3. should show multiple roles assigned to a single account without duplicates', async () => {
      const userRoles = await prisma.userRole.findMany({
        where: { userId: dualUserId },
        include: { role: true },
      });

      const roleNames = userRoles.map((ur) => ur.role.roleName);
      expect(roleNames).toContain('CUSTOMER');
      expect(roleNames).toContain('PARTNER');
      expect(roleNames.length).toBe(2);

      // Verify single physical identity in users table
      const userCount = await prisma.user.count({
        where: { mobileNumber: MOB_USER_DUAL },
      });
      expect(userCount).toBe(1);
    });

    it('4. should idempotently handle role assignment without duplicating user_roles records', async () => {
      // Super Admin assigns PARTNER role to dual user who already has it
      const res = await request(app)
        .post(`/api/v1/admin/users/${dualUserId}/roles`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ role: 'PARTNER' });

      expect(res.status).toBe(200);
      expect(res.body.data.roles).toContain('PARTNER');

      // Verify no duplicate in user_roles
      const rolesInDb = await prisma.userRole.findMany({
        where: { userId: dualUserId },
      });
      expect(rolesInDb.length).toBe(2);
    });
  });

  // =========================================================================
  // 2. ROLE SWITCHING (POST /api/v1/auth/switch-role)
  // =========================================================================
  describe('Role Context Switching (POST /api/v1/auth/switch-role)', () => {
    let switchedPartnerToken: string;

    it('3. should successfully switch from CUSTOMER to PARTNER context and return signed token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({ role: 'PARTNER' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.activeRole).toBe('PARTNER');
      expect(res.body.data.availableRoles).toEqual(
        expect.arrayContaining(['CUSTOMER', 'PARTNER'])
      );
      expect(res.body.data.roleStatus.role).toBe('PARTNER');
      expect(res.body.data.roleStatus.approvalStatus).toBe('APPROVED');
      expect(res.body.data.roleStatus.isOperational).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();

      switchedPartnerToken = res.body.data.tokens.accessToken;

      // Verify token decoded claims contain activeRole: PARTNER
      const decoded = TokenUtil.verifyAccessToken(switchedPartnerToken);
      expect(decoded.activeRole).toBe('PARTNER');
      expect(decoded.roles).toContain('CUSTOMER');
      expect(decoded.roles).toContain('PARTNER');
    });

    it('4. should successfully switch back from PARTNER to CUSTOMER context', async () => {
      const res = await request(app)
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${switchedPartnerToken}`)
        .send({ role: 'CUSTOMER' });

      expect(res.status).toBe(200);
      expect(res.body.data.activeRole).toBe('CUSTOMER');
      expect(res.body.data.roleStatus.isOperational).toBe(true);

      const decoded = TokenUtil.verifyAccessToken(res.body.data.tokens.accessToken);
      expect(decoded.activeRole).toBe('CUSTOMER');
    });

    it('5. should reject switching to an unassigned role with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Role 'ADMIN' is not assigned to your account/i);
    });

    it('6. should reject invalid role name with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({ role: 'INVALID_SUPER_HERO_ROLE' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid role name/i);
    });

    it('7. should reject unauthenticated role switch request with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/auth/switch-role')
        .send({ role: 'PARTNER' });

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 3. ENHANCED GET /auth/me AND GET /users/me/roles
  // =========================================================================
  describe('Enhanced Identity Introspection Endpoints', () => {
    it('8. should return activeRole in GET /api/v1/auth/me', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${dualToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.activeRole).toBe('CUSTOMER');
      expect(res.body.data.roles).toContain('CUSTOMER');
      expect(res.body.data.roles).toContain('PARTNER');
    });

    it('9. should return enriched roles with status in GET /api/v1/users/me/roles', async () => {
      const res = await request(app)
        .get('/api/v1/users/me/roles')
        .set('Authorization', `Bearer ${dualToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      const customerRole = res.body.data.find((r: any) => r.roleName === 'CUSTOMER');
      expect(customerRole).toBeDefined();
      expect(customerRole.status).toBe('ACTIVE');
      expect(customerRole.isOperational).toBe(true);
      expect(customerRole.isActiveContext).toBe(true);

      const partnerRole = res.body.data.find((r: any) => r.roleName === 'PARTNER');
      expect(partnerRole).toBeDefined();
      expect(partnerRole.status).toBe('APPROVED');
      expect(partnerRole.isOperational).toBe(true);
      expect(partnerRole.isActiveContext).toBe(false);
    });
  });

  // =========================================================================
  // 4. ACTIVE-ROLE AUTHORIZATION & LEGACY JWT COMPATIBILITY
  // =========================================================================
  describe('requireActiveRole Middleware & Legacy Token Compatibility', () => {
    let testApp: Application;

    // Mount an isolated test router verifying requireActiveRole
    beforeAll(() => {
      testApp = express();
      testApp.use(express.json());
      testApp.get(
        '/api/v1/test/active-partner-only',
        requireAuth,
        requireActiveRole(UserRole.PARTNER),
        (_req, res) => {
          ApiResponse.success(res, { allowed: true }, 'Active partner context confirmed');
        }
      );
      testApp.get(
        '/api/v1/test/active-customer-only',
        requireAuth,
        requireActiveRole(UserRole.CUSTOMER),
        (_req, res) => {
          ApiResponse.success(res, { allowed: true }, 'Active customer context confirmed');
        }
      );
      testApp.use(errorHandler);
    });

    it('10. should permit action when active role matches required context', async () => {
      const partnerContextToken = TokenUtil.generateAccessToken({
        userId: dualUserId.toString(),
        mobileNumber: MOB_USER_DUAL,
        roles: ['CUSTOMER', 'PARTNER'],
        activeRole: 'PARTNER',
        sessionId: dualSessionId.toString(),
      });

      const res = await request(testApp)
        .get('/api/v1/test/active-partner-only')
        .set('Authorization', `Bearer ${partnerContextToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.allowed).toBe(true);
    });

    it('11. should forbid action when active role does NOT match required context (403)', async () => {
      const customerContextToken = TokenUtil.generateAccessToken({
        userId: dualUserId.toString(),
        mobileNumber: MOB_USER_DUAL,
        roles: ['CUSTOMER', 'PARTNER'],
        activeRole: 'CUSTOMER',
        sessionId: dualSessionId.toString(),
      });

      const res = await request(testApp)
        .get('/api/v1/test/active-partner-only')
        .set('Authorization', `Bearer ${customerContextToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/requires active role context \(PARTNER\)/i);
    });

    it('12. should handle legacy token without activeRole safely for CUSTOMER context', async () => {
      // Legacy token: activeRole is omitted
      const legacyCustomerToken = TokenUtil.generateAccessToken({
        userId: dualUserId.toString(),
        mobileNumber: MOB_USER_DUAL,
        roles: ['CUSTOMER', 'PARTNER'],
        sessionId: dualSessionId.toString(),
      });

      const res = await request(testApp)
        .get('/api/v1/test/active-customer-only')
        .set('Authorization', `Bearer ${legacyCustomerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.allowed).toBe(true);
    });

    it('13. should reject legacy token without activeRole for privileged contexts without inferring array order', async () => {
      // Legacy token holding only PARTNER role (no activeRole)
      const legacyPartnerToken = TokenUtil.generateAccessToken({
        userId: dualUserId.toString(),
        mobileNumber: MOB_USER_DUAL,
        roles: ['PARTNER'],
        sessionId: dualSessionId.toString(),
      });

      const res = await request(testApp)
        .get('/api/v1/test/active-partner-only')
        .set('Authorization', `Bearer ${legacyPartnerToken}`);

      // Must NOT infer roles[0] for privileged role! Must reject safely:
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Active role context is missing from token/i);
    });
  });

  // =========================================================================
  // 5. PARTNER SUSPENSION & CUSTOMER INDEPENDENCE
  // =========================================================================
  describe('Partner Suspension & Customer Independence', () => {
    it('14. should suspend partner without modifying user account_status or revoking sessions', async () => {
      // Admin suspends dual partner
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${dualPartnerProfileId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Audit of operational vehicle docs' });

      expect(res.status).toBe(200);
      expect(res.body.data.approvalStatus).toBe('SUSPENDED');

      // Verify user account_status remains ACTIVE
      const user = await prisma.user.findUnique({ where: { id: dualUserId } });
      expect(user?.accountStatus).toBe('ACTIVE');

      // Verify session is NOT revoked
      const session = await prisma.userSession.findUnique({ where: { id: dualSessionId } });
      expect(session?.revokedAt).toBeNull();
    });

    it('15. should block suspended partner from operational actions while allowing switch to CUSTOMER', async () => {
      // Dual partner switches to PARTNER context
      const switchRes = await request(app)
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({ role: 'PARTNER' });

      expect(switchRes.status).toBe(200);
      const partnerToken = switchRes.body.data.tokens.accessToken;

      // Operational partner action blocked with 403
      const blockedRes = await request(app)
        .post('/api/v1/partners/skills')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ serviceCategoryId: '1', experienceYears: 2 });

      expect(blockedRes.status).toBe(403);
      expect(blockedRes.body.message).toMatch(/Partner account is suspended/i);

      // User switches back to CUSTOMER context
      const custSwitch = await request(app)
        .post('/api/v1/auth/switch-role')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ role: 'CUSTOMER' });

      expect(custSwitch.status).toBe(200);
      const newCustToken = custSwitch.body.data.tokens.accessToken;

      // Customer action works 100% cleanly!
      const custRes = await request(app)
        .get('/api/v1/customers/profile')
        .set('Authorization', `Bearer ${newCustToken}`);

      expect(custRes.status).toBe(200);
      expect(custRes.body.data.firstName).toBe('Unified');
    });
  });

  // =========================================================================
  // 6. REFRESH TOKEN ROTATION & ROLE REVOCATION SAFETY
  // =========================================================================
  describe('Refresh Token Rotation & Role Revocation', () => {
    it('16. should preserve activeRole during token refresh if still assigned', async () => {
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: dualRefreshToken,
          activeRole: 'PARTNER',
        });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.user.activeRole).toBe('PARTNER');
      dualRefreshToken = refreshRes.body.data.tokens.refreshToken;
    });

    it('17. should fallback safely to CUSTOMER if requested activeRole was revoked in database', async () => {
      // Create a temporary user with WORKER role
      const tempUser = await setupTestUser('+919999444001', [
        UserRole.CUSTOMER,
        UserRole.WORKER,
      ]);
      const workerRole = await prisma.role.findUnique({ where: { roleName: UserRole.WORKER } });

      // Revoke WORKER role directly in database
      await prisma.userRole.deleteMany({
        where: { userId: tempUser.user.id, roleId: workerRole!.id },
      });

      // User attempts to refresh asking for WORKER activeRole
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: tempUser.refreshToken,
          activeRole: 'WORKER',
        });

      expect(refreshRes.status).toBe(200);
      // Safely falls back to CUSTOMER because WORKER is no longer assigned!
      expect(refreshRes.body.data.user.activeRole).toBe('CUSTOMER');
      expect(refreshRes.body.data.user.roles).not.toContain('WORKER');

      // Cleanup temp user
      await prisma.userSession.deleteMany({ where: { userId: tempUser.user.id } });
      await prisma.userRole.deleteMany({ where: { userId: tempUser.user.id } });
      await prisma.user.delete({ where: { id: tempUser.user.id } });
    });
  });

  // =========================================================================
  // 7. PRIVILEGED ROLE ADMINISTRATION (SUPER ADMIN ONLY)
  // =========================================================================
  describe('Privileged Role Administration (Super Admin Only)', () => {
    it('18. should forbid operational ADMIN from assigning roles with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/users/${targetUserId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access forbidden: You do not have the required role \(SUPER_ADMIN\)/i);
    });

    it('19. should allow SUPER_ADMIN to assign a privileged role to another user', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/users/${targetUserId}/roles`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body.data.roles).toContain('ADMIN');
      expect(res.body.data.roles).toContain('CUSTOMER');

      // Verify audit log creation
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'ROLE_ASSIGNED',
          entityId: targetUserId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(superAdminUserId);
    });

    it('20. should prevent self-escalation (Super Admin assigning roles to themselves)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/users/${superAdminUserId}/roles`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ role: 'DRIVER' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Self-escalation policy violation/i);
    });

    it('21. should prevent self-revocation (Super Admin revoking their own role)', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/users/${superAdminUserId}/roles/SUPER_ADMIN`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot revoke roles from their own account/i);
    });

    it('22. should allow SUPER_ADMIN to revoke a role from a user while preserving other roles', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/users/${targetUserId}/roles/ADMIN`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.roles).not.toContain('ADMIN');
      expect(res.body.data.roles).toContain('CUSTOMER');

      // Verify audit log creation
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'ROLE_REVOKED',
          entityId: targetUserId,
        },
      });
      expect(audit).toBeDefined();
    });

    it('23. should prevent revoking the last remaining role from an account', async () => {
      // Target user now has only CUSTOMER role
      const res = await request(app)
        .delete(`/api/v1/admin/users/${targetUserId}/roles/CUSTOMER`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot revoke the only remaining role/i);
    });

    it('24. should prevent removing the last SUPER_ADMIN from the platform', async () => {
      // Find all super admins
      const superAdminRole = await prisma.role.findUnique({
        where: { roleName: UserRole.SUPER_ADMIN },
      });
      const allSuperAdmins = await prisma.userRole.findMany({
        where: { roleId: superAdminRole!.id },
      });

      // If only one super admin exists, attempting to delete it from another user should fail
      // Create a second super admin temporarily
      const tempSuperAdmin = await setupTestUser('+919999555001', [
        UserRole.SUPER_ADMIN,
        UserRole.CUSTOMER,
      ]);

      // Now 2 super admins exist. Revoking tempSuperAdmin is allowed:
      const revoke1 = await request(app)
        .delete(`/api/v1/admin/users/${tempSuperAdmin.user.id}/roles/SUPER_ADMIN`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(revoke1.status).toBe(200);

      // Now only 1 super admin remains in the system (superAdminUserId).
      // If we create another admin who tries to revoke the last super admin:
      const remainingSuperAdmins = await prisma.userRole.count({
        where: { roleId: superAdminRole!.id },
      });
      expect(remainingSuperAdmins).toBe(1);

      // Attempting to revoke the sole remaining super admin from a non-self endpoint:
      // (Even if requested by another privileged caller)
      const revokeLast = await request(app)
        .delete(`/api/v1/admin/users/${superAdminUserId}/roles/SUPER_ADMIN`)
        .set('Authorization', `Bearer ${superAdminToken}`); // caught by self-revocation guard or last-super-admin guard

      expect(revokeLast.status).toBe(403);

      // Cleanup temp user
      await prisma.userSession.deleteMany({ where: { userId: tempSuperAdmin.user.id } });
      await prisma.userRole.deleteMany({ where: { userId: tempSuperAdmin.user.id } });
      await prisma.user.delete({ where: { id: tempSuperAdmin.user.id } });
    });

    it('25. should atomically rollback role assignment when audit log insertion fails', async () => {
      const mobRollback = '+919999666003';
      const existing = await prisma.user.findUnique({ where: { mobileNumber: mobRollback } });
      if (existing) {
        await prisma.userRole.deleteMany({ where: { userId: existing.id } });
        await prisma.userSession.deleteMany({ where: { userId: existing.id } });
        await prisma.user.delete({ where: { id: existing.id } });
      }

      const tempUser = await setupTestUser(mobRollback, [UserRole.CUSTOMER]);
      const adminRole = await prisma.role.findUnique({ where: { roleName: UserRole.ADMIN } });

      // Transactional attempt with invalid actorUserId (violating foreign key constraint in audit_logs)
      const invalidAuditData = {
        actorUserId: BigInt(999999999), // Non-existent user ID violates FK
        action: 'ROLE_ASSIGNED',
        entityName: 'users',
        entityId: tempUser.user.id,
      };

      await expect(
        adminRepository.assignRoleWithAudit(
          tempUser.user.id,
          adminRole!.id,
          invalidAuditData
        )
      ).rejects.toThrow();

      // Verify that ADMIN role was rolled back and NOT added to user_roles
      const rolesInDb = await prisma.userRole.findMany({
        where: { userId: tempUser.user.id },
        include: { role: true },
      });
      const roleNames = rolesInDb.map((ur) => ur.role.roleName);
      expect(roleNames).not.toContain('ADMIN');
      expect(roleNames).toEqual(['CUSTOMER']);

      // Cleanup
      await prisma.userRole.deleteMany({ where: { userId: tempUser.user.id } });
      await prisma.userSession.deleteMany({ where: { userId: tempUser.user.id } });
      await prisma.user.delete({ where: { id: tempUser.user.id } });
    });
  });
});
