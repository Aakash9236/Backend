import request from 'supertest';
import app from '../src/app';
import { prisma, disconnectDatabase } from '../src/config/db.config';
import { TokenUtil } from '../src/common/utils/token.util';

describe('Phase 5: Authentication Module Comprehensive Test Suite', () => {
  const TEST_MOBILE_1 = '9999000001';
  const TEST_MOBILE_2 = '9999000002';
  const TEST_MOBILE_3 = '9999000003';
  const TEST_MOBILE_4 = '9999000004';
  const NORMALIZED_1 = '+919999000001';
  const NORMALIZED_2 = '+919999000002';
  const NORMALIZED_3 = '+919999000003';
  const NORMALIZED_4 = '+919999000004';
  const MOCK_OTP = '123456';

  let user1AccessToken: string;
  let user1RefreshToken: string;
  let user1Id: string;

  // Cleanup test data before and after
  const cleanupTestData = async () => {
    try {
      const numbers = [NORMALIZED_1, NORMALIZED_2, NORMALIZED_3, NORMALIZED_4];
      await prisma.otpVerification.deleteMany({
        where: { mobileNumber: { in: numbers } },
      });
      const users = await prisma.user.findMany({
        where: { mobileNumber: { in: numbers } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);
      if (userIds.length > 0) {
        await prisma.userSession.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.customerProfile.deleteMany({
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
      // ignore
    }
  };

  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectDatabase();
  });

  // -------------------------------------------------------------
  // 1. OTP REQUEST TESTS
  // -------------------------------------------------------------
  describe('POST /api/v1/auth/otp/request', () => {
    it('1. should successfully request OTP for a valid Indian mobile number', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_1 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/OTP.*sent successfully/i);
      expect(res.body.data.mobileNumber).toBe(NORMALIZED_1);
      expect(res.body.data.expiresInSeconds).toBe(300);
      expect(res.body.data.cooldownSeconds).toBe(60);
      expect(res.body.data.devMockOtp).toBe(MOCK_OTP); // Dev mock OTP
    });

    it('2. should reject invalid mobile numbers with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: '12345' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Request validation failed');
      expect(res.body.data).toBeDefined();
    });

    it('3. should enforce cooldown and reject immediate re-requests with 400', async () => {
      // Immediate second request for TEST_MOBILE_1 within 60s cooldown
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cooldown|wait/i);
    });
  });

  // -------------------------------------------------------------
  // 2. OTP VERIFICATION & REGISTRATION TESTS
  // -------------------------------------------------------------
  describe('POST /api/v1/auth/otp/verify', () => {
    it('4. should verify mock OTP and register a brand new user as CUSTOMER', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_1,
          otp: MOCK_OTP,
          deviceId: 'device-test-unit-1',
          deviceName: 'Jest Test Runner',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isNewUser).toBe(true);
      expect(res.body.data.tokens).toBeDefined();
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
      expect(res.body.data.user.mobileNumber).toBe(NORMALIZED_1);
      expect(res.body.data.user.roles).toContain('CUSTOMER');

      user1AccessToken = res.body.data.tokens.accessToken;
      user1RefreshToken = res.body.data.tokens.refreshToken;
      user1Id = res.body.data.user.id;
    });

    it('5. should reject incorrect OTP and track attempt count', async () => {
      // Request OTP for TEST_MOBILE_2
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_2 });

      // Send wrong OTP
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_2,
          otp: '999999',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid otp/i);
    });

    it('6. should lock and invalidate OTP after maximum attempts are exceeded', async () => {
      // Send 4 more wrong OTPs (total 5 attempts)
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/api/v1/auth/otp/verify')
          .send({
            mobileNumber: TEST_MOBILE_2,
            otp: '000000',
          });
      }

      // 6th attempt should return maximum attempts exceeded
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_2,
          otp: MOCK_OTP,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/maximum.*attempts|exceeded|locked/i);
    });

    it('7. should prevent replay attack on already verified OTP', async () => {
      // Re-verifying with TEST_MOBILE_1 without new request
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_1,
          otp: MOCK_OTP,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/no active otp|invalid|already.*verified/i);
    });

    it('8. should verify existing user login without creating duplicate user', async () => {
      // Directly clear OTP record in DB for TEST_MOBILE_1 to simulate cooldown expiration
      await prisma.otpVerification.deleteMany({
        where: { mobileNumber: NORMALIZED_1 },
      });

      // Request fresh OTP
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_1 });

      // Verify OTP
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_1,
          otp: MOCK_OTP,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.isNewUser).toBe(false);
      expect(res.body.data.user.id).toBe(user1Id);

      // Update tokens
      user1AccessToken = res.body.data.tokens.accessToken;
      user1RefreshToken = res.body.data.tokens.refreshToken;
    });

    it('9. should reject login for blocked or suspended user with 403 Forbidden', async () => {
      // Temporarily mark user 1 as BLOCKED
      await prisma.user.update({
        where: { id: BigInt(user1Id) },
        data: { accountStatus: 'BLOCKED' },
      });

      // Clear OTP record to allow request
      await prisma.otpVerification.deleteMany({
        where: { mobileNumber: NORMALIZED_1 },
      });

      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_1 });

      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_1,
          otp: MOCK_OTP,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/suspended|inactive|blocked/i);

      // Restore active status
      await prisma.user.update({
        where: { id: BigInt(user1Id) },
        data: { accountStatus: 'ACTIVE' },
      });
    });
  });

  // -------------------------------------------------------------
  // 3. AUTHENTICATED ACCESS (GET /me) & TOKEN VALIDATION
  // -------------------------------------------------------------
  describe('GET /api/v1/auth/me', () => {
    it('10. should return profile when valid access token is provided', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${user1AccessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(user1Id);
      expect(res.body.data.mobileNumber).toBe(NORMALIZED_1);
      expect(res.body.data.roles).toContain('CUSTOMER');
    });

    it('11. should return 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/token missing/i);
    });

    it('12. should return 401 when access token is invalid or malformed', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // 4. REFRESH TOKEN ROTATION & REUSE BREACH DETECTION
  // -------------------------------------------------------------
  describe('POST /api/v1/auth/refresh', () => {
    let rotatedAccessToken: string;
    let rotatedRefreshToken: string;

    it('13. should rotate tokens successfully and issue a new pair', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user1RefreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).not.toBe(user1RefreshToken);

      rotatedAccessToken = res.body.data.tokens.accessToken;
      rotatedRefreshToken = res.body.data.tokens.refreshToken;

      // Old token can no longer be used for refresh (reuse detection)
    });

    it('14. should detect refresh token reuse attack and terminate all user sessions', async () => {
      // Re-send the OLD (user1RefreshToken) that was already rotated
      const breachRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user1RefreshToken });

      expect(breachRes.status).toBe(401);
      expect(breachRes.body.success).toBe(false);
      expect(breachRes.body.message).toMatch(/reuse detected|breach|compromised/i);

      // Verify that previously active session is now terminated in DB
      const userSessions = await prisma.userSession.findMany({
        where: { userId: BigInt(user1Id), revokedAt: null },
      });
      expect(userSessions.length).toBe(0);

      // Rotated access token should now be rejected as session was revoked
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${rotatedAccessToken}`);

      expect(meRes.status).toBe(401);
      expect(meRes.body.message).toMatch(/terminated|revoked|expired/i);
    });
  });

  // -------------------------------------------------------------
  // 5. SESSION LOGOUT (SINGLE & ALL)
  // -------------------------------------------------------------
  describe('POST /api/v1/auth/logout and logout-all', () => {
    let sessionToken1: string;
    let sessionToken2: string;

    beforeEach(async () => {
      // Create two fresh sessions for TEST_MOBILE_3
      await prisma.otpVerification.deleteMany({
        where: { mobileNumber: NORMALIZED_3 },
      });

      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_3 });

      const login1 = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_3,
          otp: MOCK_OTP,
          deviceId: 'device-A',
        });
      sessionToken1 = login1.body.data.tokens.accessToken;

      // Clear OTP cooldown to generate second session on device B
      await prisma.otpVerification.deleteMany({
        where: { mobileNumber: NORMALIZED_3 },
      });

      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_3 });

      const login2 = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_3,
          otp: MOCK_OTP,
          deviceId: 'device-B',
        });
      sessionToken2 = login2.body.data.tokens.accessToken;
    });

    it('15. should log out from a single device and invalidate only that session', async () => {
      // Log out session 1
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${sessionToken1}`);

      expect(logoutRes.status).toBe(200);

      // Session 1 is now revoked
      const test1 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${sessionToken1}`);
      expect(test1.status).toBe(401);

      // Session 2 is still active
      const test2 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${sessionToken2}`);
      expect(test2.status).toBe(200);
    });

    it('16. should log out from all devices with logout-all', async () => {
      // Logout all devices using session 1
      const logoutAllRes = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${sessionToken1}`);

      expect(logoutAllRes.status).toBe(200);

      // Both session 1 and session 2 are now revoked
      const test1 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${sessionToken1}`);
      expect(test1.status).toBe(401);

      const test2 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${sessionToken2}`);
      expect(test2.status).toBe(401);
    });
  });

  // -------------------------------------------------------------
  // 6. ROLE-BASED ACCESS CONTROL (RBAC) TESTS
  // -------------------------------------------------------------
  describe('RBAC Role Guard Middleware Tests', () => {
    let customerToken: string;

    beforeAll(async () => {
      // Clean up and login as customer
      await prisma.otpVerification.deleteMany({
        where: { mobileNumber: NORMALIZED_1 },
      });
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_1 });
      const verify = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({
          mobileNumber: TEST_MOBILE_1,
          otp: MOCK_OTP,
        });
      customerToken = verify.body.data.tokens.accessToken;
    });

    it('17. should allow CUSTOMER role to access customer-only endpoint', async () => {
      const res = await request(app)
        .get('/api/v1/auth/test/customer-only')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('CUSTOMER');
    });

    it('18. should forbid CUSTOMER role from accessing admin-only endpoint with 403', async () => {
      const res = await request(app)
        .get('/api/v1/auth/test/admin-only')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/access forbidden|required role/i);
    });
  });

  // -------------------------------------------------------------
  // 7. CONCURRENCY HANDLING
  // -------------------------------------------------------------
  describe('Concurrent verification test', () => {
    it('19. should handle concurrent OTP verification calls gracefully without data corruption', async () => {
      await prisma.otpVerification.deleteMany({
        where: { mobileNumber: NORMALIZED_4 },
      });

      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobileNumber: TEST_MOBILE_4 });

      // Run 2 simultaneous verify requests
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/auth/otp/verify')
          .send({ mobileNumber: TEST_MOBILE_4, otp: MOCK_OTP }),
        request(app)
          .post('/api/v1/auth/otp/verify')
          .send({ mobileNumber: TEST_MOBILE_4, otp: MOCK_OTP }),
      ]);

      // Exactly one must succeed (200), the second must be rejected (400) because OTP was marked verified
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 400]);
    });
  });
});
