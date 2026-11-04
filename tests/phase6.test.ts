import request from 'supertest';
import app from '../src/app';
import { prisma, disconnectDatabase } from '../src/config/db.config';
import { TokenUtil } from '../src/common/utils/token.util';
import { ensureSeedLocations } from '../src/common/utils/seed-locations.util';

describe('Phase 6: User Management, Customer Profiles & Partner Onboarding', () => {
  const MOB_CUST1 = '+919999111001';
  const MOB_CUST2 = '+919999111002';
  const MOB_PARTNER = '+919999111003';
  const MOB_ADMIN = '+919999111004';
  const MOB_ADMIN_PARTNER = '+919999111005'; // Admin who also has a partner profile

  let cust1Token: string;
  let cust1UserId: bigint;
  let cust2Token: string;
  let cust2UserId: bigint;
  let partnerToken: string;
  let partnerUserId: bigint;
  let partnerProfileId: bigint;
  let adminToken: string;
  let adminUserId: bigint;
  let adminPartnerToken: string;
  let adminPartnerProfileId: bigint;

  let cityId: bigint;
  let areaId: bigint;
  let categoryId: bigint;

  let createdAddressId: string;
  let createdAddress2Id: string;
  let createdDocId: string;
  let createdSkillId: string;

  // Helper to create user, assign roles, create active session, and return JWT token
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

    // Assign roles
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

    // Create session
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

    return { user, token: accessToken, session };
  };

  const cleanupData = async () => {
    try {
      const mobiles = [
        MOB_CUST1,
        MOB_CUST2,
        MOB_PARTNER,
        MOB_ADMIN,
        MOB_ADMIN_PARTNER,
      ];
      const users = await prisma.user.findMany({
        where: { mobileNumber: { in: mobiles } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { actorUserId: { in: userIds } },
        });
        await prisma.partnerDocument.deleteMany({
          where: { partner: { userId: { in: userIds } } },
        });
        await prisma.partnerSkill.deleteMany({
          where: { partner: { userId: { in: userIds } } },
        });
        await prisma.partnerServiceArea.deleteMany({
          where: { partner: { userId: { in: userIds } } },
        });
        await prisma.partnerProfile.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.customerProfile.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.userAddress.deleteMany({
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
      // ignore
    }
  };

  beforeAll(async () => {
    await cleanupData();
    await ensureSeedLocations();

    const city = await prisma.city.findFirst({
      where: { citySlug: 'mumbai' },
      include: { areas: true },
    });
    if (city && city.areas.length > 0) {
      cityId = city.id;
      areaId = city.areas[0].id;
    }

    const cat = await prisma.serviceCategory.findFirst({
      where: { categoryCode: 'ELECTRICIAN' },
    });
    if (cat) {
      categoryId = cat.id;
    }

    // Setup Customer 1
    const c1 = await setupTestUser(MOB_CUST1, ['CUSTOMER']);
    cust1Token = c1.token;
    cust1UserId = c1.user.id;

    // Setup Customer 2
    const c2 = await setupTestUser(MOB_CUST2, ['CUSTOMER']);
    cust2Token = c2.token;
    cust2UserId = c2.user.id;

    // Setup Partner User
    const p = await setupTestUser(MOB_PARTNER, ['CUSTOMER']); // starts as customer
    partnerToken = p.token;
    partnerUserId = p.user.id;

    // Setup Admin User
    const a = await setupTestUser(MOB_ADMIN, ['ADMIN', 'CUSTOMER']);
    adminToken = a.token;
    adminUserId = a.user.id;

    // Setup Admin who also registers as Partner
    const ap = await setupTestUser(MOB_ADMIN_PARTNER, ['ADMIN', 'CUSTOMER']);
    adminPartnerToken = ap.token;
    const apPartner = await prisma.partnerProfile.create({
      data: {
        userId: ap.user.id,
        legalName: 'Admin Self Partner LLC',
        approvalStatus: 'PENDING',
      },
    });
    adminPartnerProfileId = apPartner.id;
  });

  afterAll(async () => {
    await cleanupData();
    await disconnectDatabase();
  });

  // =============================================================
  // SECTION 1: CUSTOMER PROFILE MODULE
  // =============================================================
  describe('Customer Profile Module (/api/v1/customers/profile)', () => {
    it('1. should return 404 when customer profile does not exist yet', async () => {
      const res = await request(app)
        .get('/api/v1/customers/profile')
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('2. should create customer profile successfully with valid data', async () => {
      const res = await request(app)
        .post('/api/v1/customers/profile')
        .set('Authorization', `Bearer ${cust1Token}`)
        .send({
          firstName: 'Rahul',
          lastName: 'Sharma',
          dateOfBirth: '1995-05-15',
          gender: 'MALE',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Rahul');
      expect(res.body.data.lastName).toBe('Sharma');
      expect(res.body.data.gender).toBe('MALE');
      expect(res.body.data.dateOfBirth).toBe('1995-05-15');
    });

    it('3. should retrieve customer profile for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/customers/profile')
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Rahul');
    });

    it('4. should update customer profile with PATCH', async () => {
      const res = await request(app)
        .patch('/api/v1/customers/profile')
        .set('Authorization', `Bearer ${cust1Token}`)
        .send({
          lastName: 'Verma',
          gender: 'MALE',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.lastName).toBe('Verma');
    });
  });

  // =============================================================
  // SECTION 2: USER MANAGEMENT & ADDRESS MANAGEMENT
  // =============================================================
  describe('User Management & Address Management (/api/v1/users)', () => {
    it('5. should retrieve authenticated user profile with roles', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mobileNumber).toBe(MOB_CUST1);
      expect(res.body.data.roles).toContain('CUSTOMER');
    });

    it('6. should update permitted user information (email)', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${cust1Token}`)
        .send({ email: 'rahul.verma@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('rahul.verma@example.com');
    });

    it('7. should list all assigned roles for user', async () => {
      const res = await request(app)
        .get('/api/v1/users/me/roles')
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].roleName).toBe('CUSTOMER');
    });

    it('8. should create address with city and area validation', async () => {
      const res = await request(app)
        .post('/api/v1/users/me/addresses')
        .set('Authorization', `Bearer ${cust1Token}`)
        .send({
          cityId: cityId.toString(),
          areaId: areaId.toString(),
          addressType: 'HOME',
          addressLine1: 'Flat 402, Sunshine Heights',
          addressLine2: 'Link Road',
          landmark: 'Near Metro Station',
          postalCode: '400058',
          latitude: 19.1363,
          longitude: 72.8277,
          isDefault: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.addressType).toBe('HOME');
      expect(res.body.data.isDefault).toBe(true);
      createdAddressId = res.body.data.id;
    });

    it('9. should reject address with invalid city ID', async () => {
      const res = await request(app)
        .post('/api/v1/users/me/addresses')
        .set('Authorization', `Bearer ${cust1Token}`)
        .send({
          cityId: '999999',
          addressType: 'WORK',
          addressLine1: 'Office 12, Tech Park',
          postalCode: '400058',
          latitude: 19.1363,
          longitude: 72.8277,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/city.*invalid|invalid.*city/i);
    });

    it('10. should create second address and manage default address uniqueness', async () => {
      const res = await request(app)
        .post('/api/v1/users/me/addresses')
        .set('Authorization', `Bearer ${cust1Token}`)
        .send({
          cityId: cityId.toString(),
          addressType: 'WORK',
          addressLine1: 'Tech Park Tower B',
          postalCode: '400058',
          latitude: 19.1363,
          longitude: 72.8277,
          isDefault: true, // Making this new address default
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isDefault).toBe(true);
      createdAddress2Id = res.body.data.id;

      // Verify that address 1 is no longer default
      const check1 = await request(app)
        .get(`/api/v1/users/me/addresses/${createdAddressId}`)
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(check1.body.data.isDefault).toBe(false);
    });

    it('11. should switch default address using PATCH /addresses/:id/default', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/me/addresses/${createdAddressId}/default`)
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isDefault).toBe(true);

      // Verify address 2 is unset from default
      const check2 = await request(app)
        .get(`/api/v1/users/me/addresses/${createdAddress2Id}`)
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(check2.body.data.isDefault).toBe(false);
    });

    it('12. should prevent cross-user address access (Customer 2 cannot view Customer 1 address)', async () => {
      const res = await request(app)
        .get(`/api/v1/users/me/addresses/${createdAddressId}`)
        .set('Authorization', `Bearer ${cust2Token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('13. should update address details', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/me/addresses/${createdAddressId}`)
        .set('Authorization', `Bearer ${cust1Token}`)
        .send({ landmark: 'Opposite Shopping Mall' });

      expect(res.status).toBe(200);
      expect(res.body.data.landmark).toBe('Opposite Shopping Mall');
    });

    it('14. should delete an address', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/me/addresses/${createdAddress2Id}`)
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  // =============================================================
  // SECTION 3: PARTNER ONBOARDING MODULE
  // =============================================================
  describe('Partner Onboarding Module (/api/v1/partners)', () => {
    it('15. should submit partner onboarding application, set PENDING status, and add PARTNER role', async () => {
      const res = await request(app)
        .post('/api/v1/partners/onboarding')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({
          profileType: 'INDIVIDUAL',
          legalName: 'Amit Kumar Electricals',
          businessDescription: 'Expert certified electrical solutions and motor servicing',
          experienceYears: 7,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.approvalStatus).toBe('PENDING');
      expect(res.body.data.legalName).toBe('Amit Kumar Electricals');
      partnerProfileId = BigInt(res.body.data.id);

      // Verify that PARTNER role was added while keeping CUSTOMER role
      const userRoles = await prisma.userRole.findMany({
        where: { userId: partnerUserId },
        include: { role: true },
      });
      const names = userRoles.map((ur) => ur.role.roleName);
      expect(names).toContain('CUSTOMER');
      expect(names).toContain('PARTNER');
    });

    it('16. should reject duplicate onboarding for the same user with 400', async () => {
      const res = await request(app)
        .post('/api/v1/partners/onboarding')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({
          legalName: 'Another Application',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/application already exists/i);
    });

    it('17. should retrieve partner profile', async () => {
      const res = await request(app)
        .get('/api/v1/partners/profile')
        .set('Authorization', `Bearer ${partnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(partnerProfileId.toString());
      expect(res.body.data.approvalStatus).toBe('PENDING');
    });

    it('18. should update partner profile information', async () => {
      const res = await request(app)
        .patch('/api/v1/partners/profile')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ experienceYears: 8 });

      expect(res.status).toBe(200);
      expect(res.body.data.experienceYears).toBe(8);
    });

    it('19. should upload and register KYC document', async () => {
      const fakePdfBuffer = Buffer.from('%PDF-1.4 test document stream');

      const res = await request(app)
        .post('/api/v1/partners/documents')
        .set('Authorization', `Bearer ${partnerToken}`)
        .attach('file', fakePdfBuffer, 'aadhaar_card.pdf')
        .field('documentType', 'AADHAAR');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.documentType).toBe('AADHAAR');
      expect(res.body.data.verificationStatus).toBe('PENDING');
      expect(res.body.data.documentStorageKey).toBeDefined();
      createdDocId = res.body.data.id;
    });

    it('20. should list partner documents', async () => {
      const res = await request(app)
        .get('/api/v1/partners/documents')
        .set('Authorization', `Bearer ${partnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].documentType).toBe('AADHAAR');
    });

    it('21. should add service skill to partner profile', async () => {
      const res = await request(app)
        .post('/api/v1/partners/skills')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({
          serviceCategoryId: categoryId.toString(),
          experienceYears: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe('PENDING');
      createdSkillId = res.body.data.id;
    });

    it('22. should prevent duplicate skill addition for same category', async () => {
      const res = await request(app)
        .post('/api/v1/partners/skills')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({
          serviceCategoryId: categoryId.toString(),
          experienceYears: 5,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already.*added/i);
    });

    it('23. should list partner skills', async () => {
      const res = await request(app)
        .get('/api/v1/partners/skills')
        .set('Authorization', `Bearer ${partnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].categoryName).toBe('Electrician');
    });

    it('24. should add service area to partner profile', async () => {
      const res = await request(app)
        .post('/api/v1/partners/service-areas')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({
          cityId: cityId.toString(),
          areaId: areaId.toString(),
          coverageType: 'AREA',
          serviceRadiusKm: 15,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cityName).toBe('Mumbai');
    });

    it('25. should list partner service areas', async () => {
      const res = await request(app)
        .get('/api/v1/partners/service-areas')
        .set('Authorization', `Bearer ${partnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =============================================================
  // SECTION 4: ADMIN PARTNER APPROVAL & AUDIT LOGS
  // =============================================================
  describe('Admin Partner Approval Module (/api/v1/admin)', () => {
    it('26. should reject non-admin users with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners/pending')
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('27. should allow admin to view pending partner applications', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const ids = res.body.data.map((p: any) => p.id);
      expect(ids).toContain(partnerProfileId.toString());
    });

    it('28. should retrieve full partner dossier for admin inspection', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${partnerProfileId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.legalName).toBe('Amit Kumar Electricals');
      expect(res.body.data.documents.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.skills.length).toBeGreaterThanOrEqual(1);
    });

    it('29. should prevent admins from approving their own partner profile with 403', async () => {
      // AdminPartner attempts to approve their own partner profile
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${adminPartnerProfileId}/approve`)
        .set('Authorization', `Bearer ${adminPartnerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot review or approve their own/i);
    });

    it('30. should approve partner application and record audit log', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partnerProfileId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.approvalStatus).toBe('APPROVED');

      // Verify audit log creation
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'PARTNER_APPROVED',
          entityId: partnerProfileId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
    });

    it('31. should reject approving an already approved partner with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partnerProfileId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already.*approved/i);
    });

    it('32. should verify partner KYC document and write audit log', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/documents/${createdDocId}/verify`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.verificationStatus).toBe('VERIFIED');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'PARTNER_DOCUMENT_VERIFIED',
          entityId: BigInt(createdDocId),
        },
      });
      expect(audit).toBeDefined();
    });

    it('33. should verify partner service skill and write audit log', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/skills/${createdSkillId}/verify`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.verificationStatus).toBe('VERIFIED');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'PARTNER_SKILL_VERIFIED',
          entityId: BigInt(createdSkillId),
        },
      });
      expect(audit).toBeDefined();
    });

    it('34. should reject partner document with mandatory reason', async () => {
      // Create another document to test rejection
      const doc = await prisma.partnerDocument.create({
        data: {
          partnerId: partnerProfileId,
          documentType: 'PAN',
          documentStorageKey: 'documents/fake_pan.pdf',
          verificationStatus: 'PENDING',
        },
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/documents/${doc.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'PAN image is blurry and name is illegible' });

      expect(res.status).toBe(200);
      expect(res.body.data.verificationStatus).toBe('REJECTED');
      expect(res.body.data.rejectionReason).toBe('PAN image is blurry and name is illegible');
    });

    it('35. should suspend partner with mandatory reason', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partnerProfileId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Regulatory compliance review pending' });

      expect(res.status).toBe(200);
      expect(res.body.data.approvalStatus).toBe('SUSPENDED');
    });
  });

  // =============================================================
  // SECTION 5: SAFE USER ACCOUNT DEACTIVATION
  // =============================================================
  describe('Safe User Deactivation (DELETE /api/v1/users/me)', () => {
    it('36. should safely deactivate user account and terminate all sessions', async () => {
      const res = await request(app)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.deactivated).toBe(true);

      // Verify user status in database is now DELETED
      const user = await prisma.user.findUnique({
        where: { id: cust1UserId },
      });
      expect(user?.accountStatus).toBe('DELETED');

      // Subsequent requests with the same token must fail with 401
      const retry = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${cust1Token}`);

      expect(retry.status).toBe(401);
    });
  });
});
