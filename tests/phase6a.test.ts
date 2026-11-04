import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../src/app';
import { prisma, disconnectDatabase } from '../src/config/db.config';
import { TokenUtil } from '../src/common/utils/token.util';
import { defaultKycPolicyProvider } from '../src/modules/admin/services/kyc-validation.service';
import { adminRepository } from '../src/modules/admin/admin.repository';

describe('Phase 6A: Security Remediation & Hardening Verification', () => {
  const MOB_TEST_CUST = '+919999222001';
  const MOB_TEST_DUAL = '+919999222002'; // Dual role: Customer + Partner
  const MOB_TEST_ADMIN = '+919999222003';
  const MOB_TEST_PARTNER_PENDING = '+919999222004';

  let custToken: string;
  let custUserId: bigint;
  let dualToken: string;
  let dualUserId: bigint;
  let dualPartnerId: bigint;
  let dualRefreshToken: string;
  let adminToken: string;
  let adminUserId: bigint;
  let pendingPartnerToken: string;
  let pendingPartnerId: bigint;

  let categoryId: bigint;
  let cityId: bigint;
  let testDocumentId: bigint;
  let testStorageKey: string;

  // Helper to set up user, roles, session, and JWT
  const setupTestUser = async (mobileNumber: string, roleNames: string[]) => {
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
      sessionId: session.id.toString(),
    });

    return { user, token: accessToken, session, refreshToken: rawRefreshToken };
  };

  const cleanupData = async () => {
    try {
      defaultKycPolicyProvider.clearRules();

      const testMobiles = [
        MOB_TEST_CUST,
        MOB_TEST_DUAL,
        MOB_TEST_ADMIN,
        MOB_TEST_PARTNER_PENDING,
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
          await prisma.auditLog.deleteMany({
            where: {
              entityName: { in: ['partner_profiles', 'partner_documents', 'partner_skills'] },
              entityId: { in: partnerIds },
            },
          });
          await prisma.partnerDocument.deleteMany({
            where: { partnerId: { in: partnerIds } },
          });
          await prisma.partnerSkill.deleteMany({
            where: { partnerId: { in: partnerIds } },
          });
          await prisma.partnerServiceArea.deleteMany({
            where: { partnerId: { in: partnerIds } },
          });
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

      // Cleanup local test upload file if exists
      const testFilePath = path.resolve('uploads', 'documents', 'test_sample.png');
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    } catch (err) {
      // ignore cleanup errors
    }
  };

  beforeAll(async () => {
    await cleanupData();

    // Setup Admin
    const adminSetup = await setupTestUser(MOB_TEST_ADMIN, ['ADMIN', 'SUPER_ADMIN']);
    adminToken = adminSetup.token;
    adminUserId = adminSetup.user.id;

    // Setup Customer
    const custSetup = await setupTestUser(MOB_TEST_CUST, ['CUSTOMER']);
    custToken = custSetup.token;
    custUserId = custSetup.user.id;
    await prisma.customerProfile.create({
      data: {
        userId: custUserId,
        firstName: 'Test',
        lastName: 'Customer',
      },
    });

    // Setup Dual User (Customer + Partner)
    const dualSetup = await setupTestUser(MOB_TEST_DUAL, ['CUSTOMER', 'PARTNER']);
    dualToken = dualSetup.token;
    dualUserId = dualSetup.user.id;
    dualRefreshToken = dualSetup.refreshToken;

    await prisma.customerProfile.create({
      data: {
        userId: dualUserId,
        firstName: 'Dual Customer',
        lastName: 'Partner',
      },
    });

    const dualPartner = await prisma.partnerProfile.create({
      data: {
        userId: dualUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Dual Services Provider',
        approvalStatus: 'PENDING',
      },
    });
    dualPartnerId = dualPartner.id;

    // Setup Pending Partner
    const pendingSetup = await setupTestUser(MOB_TEST_PARTNER_PENDING, ['PARTNER']);
    pendingPartnerToken = pendingSetup.token;
    const pendingPartner = await prisma.partnerProfile.create({
      data: {
        userId: pendingSetup.user.id,
        profileType: 'BUSINESS',
        legalName: 'Pending Express Logistics',
        approvalStatus: 'PENDING',
      },
    });
    pendingPartnerId = pendingPartner.id;

    // Fetch existing category and city for operations
    let category = await prisma.serviceCategory.findFirst();
    if (!category) {
      category = await prisma.serviceCategory.create({
        data: {
          categoryName: 'Security Testing Services',
          categoryCode: 'SEC_TEST',
          isActive: true,
        },
      });
    }
    categoryId = category.id;

    let city = await prisma.city.findFirst();
    if (!city) {
      city = await prisma.city.create({
        data: {
          cityName: 'SecurityCity',
          citySlug: 'securitycity',
          stateName: 'State',
          isActive: true,
        },
      });
    }
    cityId = city.id;

    // Create a real physical sample test document
    const uploadsDir = path.resolve('uploads', 'documents');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const samplePngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const sampleFilename = `sample_test_${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadsDir, sampleFilename), samplePngBuffer);
    testStorageKey = `documents/${sampleFilename}`;

    const doc = await prisma.partnerDocument.create({
      data: {
        partnerId: dualPartnerId,
        documentType: 'DRIVING_LICENSE',
        documentStorageKey: testStorageKey,
        verificationStatus: 'PENDING',
      },
    });
    testDocumentId = doc.id;
  });

  afterAll(async () => {
    await cleanupData();
    await disconnectDatabase();
  });

  // =========================================================================
  // ISSUE A: KYC POLICY ENGINE & APPROVAL GATE
  // =========================================================================
  describe('Issue A: KYC Validation Engine & Approval Gate', () => {
    it('1. should reject partner approval when mandatory documents are missing (400)', async () => {
      // Configure policy requiring DRIVING_LICENSE and VEHICLE_RC for dual partner
      defaultKycPolicyProvider.setPartnerRule(dualPartnerId, {
        requiredTypes: ['DRIVING_LICENSE', 'VEHICLE_RC'],
        optionalTypes: ['OTHER'],
      });

      // Dual partner only has DRIVING_LICENSE (which is also PENDING), VEHICLE_RC is missing
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${dualPartnerId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Mandatory document missing: VEHICLE_RC/i);
    });

    it('2. should reject approval when mandatory document is PENDING (400)', async () => {
      // Provide VEHICLE_RC but keep DRIVING_LICENSE PENDING
      const addrDoc = await prisma.partnerDocument.create({
        data: {
          partnerId: dualPartnerId,
          documentType: 'VEHICLE_RC',
          documentStorageKey: testStorageKey,
          verificationStatus: 'VERIFIED',
        },
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${dualPartnerId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Mandatory document 'DRIVING_LICENSE' is not verified/i);

      await prisma.partnerDocument.delete({ where: { id: addrDoc.id } });
    });

    it('3. should reject approval when mandatory document is REJECTED (400)', async () => {
      await prisma.partnerDocument.update({
        where: { id: testDocumentId },
        data: { verificationStatus: 'REJECTED', rejectionReason: 'Illegible image' },
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${dualPartnerId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not verified.*REJECTED/i);
    });

    it('3b. should reject approval when mandatory document is EXPIRED (UTC comparison)', async () => {
      const { kycValidationService } = await import(
        '../src/modules/admin/services/kyc-validation.service'
      );
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday in UTC
      const validation = await kycValidationService.validateForApproval(
        { id: dualPartnerId, profileType: 'INDIVIDUAL' },
        [
          {
            documentType: 'DRIVING_LICENSE',
            verificationStatus: 'VERIFIED',
            expiryDate: pastDate,
          },
        ]
      );

      expect(validation.isValid).toBe(false);
      expect(validation.expiredTypes).toContain('DRIVING_LICENSE');
      expect(validation.reasons[0]).toMatch(/has expired/i);
    });

    it('3c. should fail-closed when KYC policy provider is unavailable or returns invalid policy', async () => {
      const { KycValidationService } = await import(
        '../src/modules/admin/services/kyc-validation.service'
      );
      // Faulty policy provider that throws
      const faultyService = new KycValidationService({
        getRulesForPartner: async () => {
          throw new Error('Database connection failed');
        },
      });

      const result = await faultyService.validateForApproval(
        { id: dualPartnerId, profileType: 'INDIVIDUAL' },
        []
      );

      expect(result.isValid).toBe(false);
      expect(result.reasons[0]).toMatch(/fail-closed/i);

      // Faulty provider that returns null/invalid specification
      const invalidPolicyService = new KycValidationService({
        getRulesForPartner: async () => null,
      });

      const result2 = await invalidPolicyService.validateForApproval(
        { id: dualPartnerId, profileType: 'INDIVIDUAL' },
        []
      );

      expect(result2.isValid).toBe(false);
      expect(result2.reasons[0]).toMatch(/fail-closed/i);
    });

    it('4. should approve partner when mandatory docs are VERIFIED even if OPTIONAL document is REJECTED', async () => {
      // Set rule: Required = DRIVING_LICENSE, Optional = OTHER
      defaultKycPolicyProvider.setPartnerRule(dualPartnerId, {
        requiredTypes: ['DRIVING_LICENSE'],
        optionalTypes: ['OTHER'],
      });

      // Verify the mandatory document
      await prisma.partnerDocument.update({
        where: { id: testDocumentId },
        data: { verificationStatus: 'VERIFIED', rejectionReason: null },
      });

      // Add a REJECTED optional document
      const optDoc = await prisma.partnerDocument.create({
        data: {
          partnerId: dualPartnerId,
          documentType: 'OTHER',
          documentStorageKey: testStorageKey,
          verificationStatus: 'REJECTED',
          rejectionReason: 'Optional document not acceptable',
        },
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${dualPartnerId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.approvalStatus).toBe('APPROVED');

      await prisma.partnerDocument.delete({ where: { id: optDoc.id } });
    });
  });

  // =========================================================================
  // ISSUE C: PARTNER SUSPENSION STATE MACHINE TRANSITIONS
  // =========================================================================
  describe('Issue C: Strict Suspension State Machine Transitions', () => {
    it('5. should reject suspending a PENDING partner with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${pendingPartnerId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Compliance issue' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid state transition: Cannot suspend partner in 'PENDING' status/i);
    });

    it('6. should reject suspending a REJECTED partner with 400 Bad Request', async () => {
      // Reject the pending partner
      await request(app)
        .patch(`/api/v1/admin/partners/${pendingPartnerId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Incomplete business docs' });

      // Attempt to suspend
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${pendingPartnerId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Attempt to suspend rejected' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot suspend partner in 'REJECTED' status/i);
    });

    it('7. should suspend an APPROVED partner with 200 OK and record audit log', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${dualPartnerId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Policy violation investigation' });

      expect(res.status).toBe(200);
      expect(res.body.data.approvalStatus).toBe('SUSPENDED');

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'PARTNER_SUSPENDED',
          entityId: dualPartnerId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
    });

    it('8. should reject suspending an already SUSPENDED partner with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${dualPartnerId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Second suspension attempt' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot suspend partner in 'SUSPENDED' status/i);
    });
  });

  // =========================================================================
  // ISSUE B: SUSPENDED PARTNER AUTHORIZATION & CUSTOMER SESSION INTEGRITY
  // =========================================================================
  describe('Issue B: Suspended Partner Authorization & Customer Session Integrity', () => {
    it('9. should block suspended partner from operational actions (POST /skills) with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/partners/skills')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({
          serviceCategoryId: categoryId.toString(),
          experienceYears: 4,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Partner account is suspended/i);
    });

    it('10. should block suspended partner from updating profile (PATCH /profile) with 403 Forbidden', async () => {
      const res = await request(app)
        .patch('/api/v1/partners/profile')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({
          legalName: 'Attempted Renaming While Suspended',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Partner account is suspended/i);
    });

    it('11. should block suspended partner from uploading documents (POST /documents) with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/partners/documents')
        .set('Authorization', `Bearer ${dualToken}`)
        .field('documentType', 'PAN')
        .attach('file', Buffer.from('test doc'), 'test.pdf');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Partner account is suspended/i);
    });

    it('12. should allow suspended partner to read their profile (GET /profile) to inspect status', async () => {
      const res = await request(app)
        .get('/api/v1/partners/profile')
        .set('Authorization', `Bearer ${dualToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.approvalStatus).toBe('SUSPENDED');
      expect(res.body.data.rejectionReason).toBe('Policy violation investigation');
    });

    it('13. should preserve CUSTOMER access for dual-role user after partner suspension', async () => {
      // 1. User profile access
      const userRes = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${dualToken}`);

      expect(userRes.status).toBe(200);
      expect(userRes.body.data.accountStatus).toBe('ACTIVE');

      // 2. Customer profile access
      const custRes = await request(app)
        .get('/api/v1/customers/profile')
        .set('Authorization', `Bearer ${dualToken}`);

      expect(custRes.status).toBe(200);
      expect(custRes.body.data.firstName).toBe('Dual Customer');
    });

    it('14. should rotate refresh tokens successfully without bypassing partner suspension', async () => {
      // 1. Refresh token rotation
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: dualRefreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.tokens.accessToken).toBeDefined();

      const newAccessToken = refreshRes.body.data.tokens.accessToken;

      // 2. Verify operational partner endpoint is STILL blocked with the refreshed token!
      const blockedRes = await request(app)
        .post('/api/v1/partners/skills')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .send({
          serviceCategoryId: categoryId.toString(),
          experienceYears: 3,
        });

      expect(blockedRes.status).toBe(403);
      expect(blockedRes.body.message).toMatch(/Partner account is suspended/i);

      // 3. But customer endpoint works with refreshed token!
      const custRes = await request(app)
        .get('/api/v1/customers/profile')
        .set('Authorization', `Bearer ${newAccessToken}`);

      expect(custRes.status).toBe(200);
    });
  });

  // =========================================================================
  // ISSUE D: ATOMIC ADMIN MUTATIONS & AUDIT LOGGING
  // =========================================================================
  describe('Issue D: Atomic Admin Mutations & Audit Logging', () => {
    it('15. should atomically rollback partner status update if audit log insert fails', async () => {
      const initialPartner = await prisma.partnerProfile.findUnique({
        where: { id: dualPartnerId },
      });
      const initialStatus = initialPartner?.approvalStatus;

      // Attempt transactional update with an invalid actorUserId that violates FK constraint
      const invalidAuditData = {
        actorUserId: BigInt(999999999), // Non-existent user ID violates FK in audit_logs
        action: 'PARTNER_APPROVED',
        entityName: 'partner_profiles',
        entityId: dualPartnerId,
      };

      await expect(
        adminRepository.updatePartnerStatusWithAudit(
          dualPartnerId,
          { status: 'APPROVED', adminUserId: adminUserId },
          invalidAuditData
        )
      ).rejects.toThrow();

      // Verify that partner status was ROLLED BACK and remains SUSPENDED
      const partnerAfterFailure = await prisma.partnerProfile.findUnique({
        where: { id: dualPartnerId },
      });
      expect(partnerAfterFailure?.approvalStatus).toBe(initialStatus);
    });
  });

  // =========================================================================
  // ISSUE E: SECURE KYC DOCUMENT STREAMING
  // =========================================================================
  describe('Issue E: Secure KYC Document Streaming (GET /admin/partners/documents/:id/file)', () => {
    it('16. should reject unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app).get(
        `/api/v1/admin/partners/documents/${testDocumentId}/file`
      );

      expect(res.status).toBe(401);
    });

    it('17. should reject non-admin users with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/documents/${testDocumentId}/file`)
        .set('Authorization', `Bearer ${custToken}`);

      expect(res.status).toBe(403);
    });

    it('18. should reject invalid or non-numeric document IDs with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners/documents/invalid-id/file')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid document ID/i);
    });

    it('19. should return 404 when document record does not exist in DB', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners/documents/88888888/file')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/document.*not found/i);
    });

    it('20. should return 404 without leaking server paths when physical file is missing', async () => {
      // Create a doc pointing to non-existent storage key
      const missingDoc = await prisma.partnerDocument.create({
        data: {
          partnerId: dualPartnerId,
          documentType: 'PAN',
          documentStorageKey: 'documents/non_existent_file_9999.png',
          verificationStatus: 'PENDING',
        },
      });

      const res = await request(app)
        .get(`/api/v1/admin/partners/documents/${missingDoc.id}/file`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      // Ensure local server path (C:\ or /home/) is NOT leaked in message
      expect(res.body.message).not.toMatch(/[C-Z]:\\|\/uploads\//i);
      expect(res.body.message).toMatch(/not found on storage server/i);

      await prisma.partnerDocument.delete({ where: { id: missingDoc.id } });
    });

    it('21. should stream binary content with safe Content-Type and Content-Disposition for admin', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/documents/${testDocumentId}/file`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toMatch(/inline; filename="partner_doc_/i);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toMatch(/no-store/i);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });
});
