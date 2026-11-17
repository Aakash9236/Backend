import request from 'supertest';
import app from '../src/app';
import { prisma, disconnectDatabase } from '../src/config/db.config';
import { TokenUtil } from '../src/common/utils/token.util';
import { UserRole } from '../src/common/constants';
import { DateUtil } from '../src/common/utils/date.util';

describe('Phase 6D: Final API Integration & End-to-End Verification Test Suite', () => {
  // Mobile numbers isolated for Phase 6D API integration tests
  const MOB_PARTNER_A = '+919813000001';
  const MOB_PARTNER_B = '+919813000002';
  const MOB_DRIVER_1 = '+919813000003';
  const MOB_DRIVER_2 = '+919813000004';
  const MOB_ADMIN = '+919813000005';
  const MOB_ADMIN_DRIVER = '+919813000006'; // Admin who also has driver profile (self-approval test)

  let partnerAUser: any;
  let partnerAToken: string;
  let partnerAProfile: any;

  let partnerBUser: any;
  let partnerBToken: string;
  let partnerBProfile: any;

  let driver1User: any;
  let driver1Token: string;

  let driver2User: any;
  let driver2Token: string;

  let adminUser: any;
  let adminToken: string;

  let adminDriverUser: any;
  let adminDriverToken: string;

  let testServiceCategory: any;
  let testVehicleTypeTwoWheeler: any;
  let testVehicleTypeTataAce: any;
  let testVehiclePartnerA: any;

  // 1x1 transparent PNG buffer for document upload
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  const setupUser = async (
    mobileNumber: string,
    roleNames: string[],
    activeRole?: string
  ) => {
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

    return { user, token: accessToken, session };
  };

  const cleanupAllTestData = async () => {
    try {
      const mobiles = [
        MOB_PARTNER_A,
        MOB_PARTNER_B,
        MOB_DRIVER_1,
        MOB_DRIVER_2,
        MOB_ADMIN,
        MOB_ADMIN_DRIVER,
      ];

      const users = await prisma.user.findMany({
        where: { mobileNumber: { in: mobiles } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        const drivers = await prisma.driverProfile.findMany({
          where: { userId: { in: userIds } },
          select: { id: true },
        });
        const driverIds = drivers.map((d) => d.id);

        const partners = await prisma.partnerProfile.findMany({
          where: { userId: { in: userIds } },
          select: { id: true },
        });
        const partnerIds = partners.map((p) => p.id);

        // Delete assignments
        await prisma.driverVehicleAssignment.deleteMany({
          where: {
            OR: [
              { driverId: { in: driverIds } },
              { partnerId: { in: partnerIds } },
            ],
          },
        });

        // Delete availability
        await prisma.driverAvailability.deleteMany({
          where: { driverId: { in: driverIds } },
        });

        // Delete affiliations
        await prisma.driverPartnerAffiliation.deleteMany({
          where: {
            OR: [
              { driverId: { in: driverIds } },
              { partnerId: { in: partnerIds } },
            ],
          },
        });

        // Delete invitations
        await prisma.driverInvitation.deleteMany({
          where: {
            OR: [
              { partnerId: { in: partnerIds } },
              { invitedMobile: { in: mobiles } },
            ],
          },
        });

        // Delete documents
        await prisma.driverDocument.deleteMany({
          where: { driverId: { in: driverIds } },
        });

        // Delete driver profiles
        await prisma.driverProfile.deleteMany({
          where: { id: { in: driverIds } },
        });

        // Delete partner vehicles & documents
        if (partnerIds.length > 0) {
          const partnerVehicles = await prisma.partnerVehicle.findMany({
            where: { partnerId: { in: partnerIds } },
            select: { vehicleId: true },
          });
          const vehicleIds = partnerVehicles.map((pv) => pv.vehicleId);

          await prisma.partnerVehicle.deleteMany({
            where: { partnerId: { in: partnerIds } },
          });
          await prisma.vehicleDocument.deleteMany({
            where: { vehicleId: { in: vehicleIds } },
          });
          await prisma.vehicle.deleteMany({
            where: { id: { in: vehicleIds } },
          });
          await prisma.partnerProfile.deleteMany({
            where: { id: { in: partnerIds } },
          });
        }

        // Delete audit logs created during test
        await prisma.auditLog.deleteMany({
          where: { actorUserId: { in: userIds } },
        });

        // Delete sessions & roles
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
    } catch (err) {
      // ignore cleanup errors
    }
  };

  beforeAll(async () => {
    await cleanupAllTestData();

    // 1. Service category & vehicle types
    let cat = await prisma.serviceCategory.findFirst();
    if (!cat) {
      cat = await prisma.serviceCategory.create({
        data: {
          categoryCode: 'LOGISTICS_TEST_6D',
          categoryName: 'Logistics Test 6D',
          isActive: true,
        },
      });
    }
    testServiceCategory = cat;

    let vType = await prisma.vehicleType.findFirst({ where: { typeCode: 'TWO_WHEELER' } });
    if (!vType) {
      vType = await prisma.vehicleType.create({
        data: {
          typeCode: 'TWO_WHEELER',
          typeName: 'Two Wheeler (Motorcycle)',
          serviceCategoryId: testServiceCategory.id,
          capacityKg: 50,
          isActive: true,
        },
      });
    }
    testVehicleTypeTwoWheeler = vType;

    // 2. Setup Partner A
    const resA = await setupUser(MOB_PARTNER_A, [UserRole.CUSTOMER, UserRole.PARTNER], UserRole.PARTNER);
    partnerAUser = resA.user;
    partnerAToken = resA.token;

    partnerAProfile = await prisma.partnerProfile.create({
      data: {
        userId: partnerAUser.id,
        profileType: 'BUSINESS',
        legalName: 'Apex City Logistics LLP',
        businessName: 'Apex Fleet Logistics',
        approvalStatus: 'APPROVED',
      },
    });

    // Register vehicle for Partner A
    const existingVehicleA = await prisma.vehicle.findUnique({
      where: { registrationNumber: 'KA01PH6D1001' },
    });
    if (existingVehicleA) {
      await prisma.partnerVehicle.deleteMany({ where: { vehicleId: existingVehicleA.id } });
      await prisma.driverVehicleAssignment.deleteMany({ where: { vehicleId: existingVehicleA.id } });
      await prisma.vehicle.delete({ where: { id: existingVehicleA.id } });
    }

    testVehiclePartnerA = await prisma.vehicle.create({
      data: {
        vehicleTypeId: testVehicleTypeTwoWheeler.id,
        registrationNumber: 'KA01PH6D1001',
        rcNumber: 'RC-KA01PH6D1001',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });

    await prisma.partnerVehicle.create({
      data: {
        partnerId: partnerAProfile.id,
        vehicleId: testVehiclePartnerA.id,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: true,
      },
    });

    // 3. Setup Partner B (Tenant Isolation verification)
    const resB = await setupUser(MOB_PARTNER_B, [UserRole.CUSTOMER, UserRole.PARTNER], UserRole.PARTNER);
    partnerBUser = resB.user;
    partnerBToken = resB.token;

    partnerBProfile = await prisma.partnerProfile.create({
      data: {
        userId: partnerBUser.id,
        profileType: 'INDIVIDUAL',
        legalName: 'Blue Dart Partner B',
        businessName: 'Blue Dart Fleet',
        approvalStatus: 'APPROVED',
      },
    });

    // 4. Setup Driver 1
    const resD1 = await setupUser(MOB_DRIVER_1, [UserRole.CUSTOMER, UserRole.DRIVER], UserRole.DRIVER);
    driver1User = resD1.user;
    driver1Token = resD1.token;

    // 5. Setup Driver 2
    const resD2 = await setupUser(MOB_DRIVER_2, [UserRole.CUSTOMER, UserRole.DRIVER], UserRole.DRIVER);
    driver2User = resD2.user;
    driver2Token = resD2.token;

    // 6. Setup Admin
    const resAdm = await setupUser(MOB_ADMIN, [UserRole.ADMIN, UserRole.SUPER_ADMIN], UserRole.ADMIN);
    adminUser = resAdm.user;
    adminToken = resAdm.token;

    // 7. Setup Admin who is also a Driver
    const resAdmDrv = await setupUser(MOB_ADMIN_DRIVER, [UserRole.ADMIN, UserRole.DRIVER], UserRole.ADMIN);
    adminDriverUser = resAdmDrv.user;
    adminDriverToken = resAdmDrv.token;
  });

  afterAll(async () => {
    await cleanupAllTestData();
    await disconnectDatabase();
  });

  // ==========================================================================
  // 1. Authentication & Role Context Enforcement
  // ==========================================================================

  describe('1. Authentication & Role Context Guards', () => {
    it('should reject unauthenticated request to /api/v1/drivers/me with 401', async () => {
      const res = await request(app).get('/api/v1/drivers/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject partner endpoints when called without active PARTNER role with 403', async () => {
      const res = await request(app)
        .get('/api/v1/partners/drivers/invitations')
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/active role context/i);
    });

    it('should reject admin endpoints when called by non-admin with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/drivers/pending')
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/required role/i);
    });
  });

  // ==========================================================================
  // 2. Driver Onboarding, Profile & Document Management
  // ==========================================================================

  describe('2. Driver Profile & Document Lifecycle', () => {
    let driver1ProfileId: string;
    let uploadedDocId: string;

    it('GET /api/v1/drivers/me should auto-provision a DRAFT/PENDING profile', async () => {
      const res = await request(app)
        .get('/api/v1/drivers/me')
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.submissionStatus).toBe('DRAFT');
      expect(res.body.data.approvalStatus).toBe('PENDING');
      driver1ProfileId = res.body.data.id;
    });

    it('PUT /api/v1/drivers/me should update profile details and licence classes', async () => {
      const res = await request(app)
        .put('/api/v1/drivers/me')
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({
          firstName: 'Rajesh',
          lastName: 'Kumar',
          dateOfBirth: '1992-05-15',
          gender: 'MALE',
          bio: 'Experienced delivery driver with 6 years experience in Bengaluru city.',
          experienceYears: 6,
          licenceNumber: 'KA-01-2015-0012345',
          licenceClasses: ['MCWG', 'LMV'],
          licenceExpiryDate: '2030-12-31',
          issuingAuthority: 'RTO Bangalore Central',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Rajesh');
      expect(res.body.data.licenceClasses).toEqual(['MCWG', 'LMV']);
    });

    it('POST /api/v1/drivers/me/documents should upload a document successfully', async () => {
      const res = await request(app)
        .post('/api/v1/drivers/me/documents')
        .set('Authorization', `Bearer ${driver1Token}`)
        .field('documentType', 'DRIVING_LICENCE')
        .field('documentNumber', 'KA-01-2015-0012345')
        .field('expiryDate', '2030-12-31')
        .attach('file', dummyPng, 'licence.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.documentType).toBe('DRIVING_LICENCE');
      expect(res.body.data.verificationStatus).toBe('PENDING');
      uploadedDocId = res.body.data.id;
    });

    it('POST /api/v1/drivers/me/documents should upload PROFILE_PHOTO and IDENTITY_PROOF', async () => {
      const photoRes = await request(app)
        .post('/api/v1/drivers/me/documents')
        .set('Authorization', `Bearer ${driver1Token}`)
        .field('documentType', 'PROFILE_PHOTO')
        .attach('file', dummyPng, 'photo.png');
      expect(photoRes.status).toBe(201);

      const idRes = await request(app)
        .post('/api/v1/drivers/me/documents')
        .set('Authorization', `Bearer ${driver1Token}`)
        .field('documentType', 'IDENTITY_PROOF')
        .field('documentNumber', 'AADHAAR-1234-5678')
        .attach('file', dummyPng, 'aadhaar.png');
      expect(idRes.status).toBe(201);
    });

    it('GET /api/v1/drivers/me/documents should list all uploaded documents', async () => {
      const res = await request(app)
        .get('/api/v1/drivers/me/documents')
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('GET /api/v1/drivers/me/documents/:id/file should securely stream file to owner', async () => {
      const res = await request(app)
        .get(`/api/v1/drivers/me/documents/${uploadedDocId}/file`)
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/png/i);
    });

    it('GET /api/v1/drivers/me/documents/:id/file should reject access by another driver with 403 (IDOR block)', async () => {
      // Ensure Driver 2 has a profile
      await request(app)
        .get('/api/v1/drivers/me')
        .set('Authorization', `Bearer ${driver2Token}`);

      const res = await request(app)
        .get(`/api/v1/drivers/me/documents/${uploadedDocId}/file`)
        .set('Authorization', `Bearer ${driver2Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission/i);
    });

    it('POST /api/v1/drivers/me/submit should submit profile for admin review', async () => {
      const res = await request(app)
        .post('/api/v1/drivers/me/submit')
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.submissionStatus).toBe('SUBMITTED');
      expect(res.body.data.approvalStatus).toBe('PENDING');
    });

    it('GET /api/v1/drivers/me/status should return SUBMITTED and PENDING', async () => {
      const res = await request(app)
        .get('/api/v1/drivers/me/status')
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.submissionStatus).toBe('SUBMITTED');
      expect(res.body.data.approvalStatus).toBe('PENDING');
    });
  });

  // ==========================================================================
  // 3. Admin Review, Document Verification & Governance
  // ==========================================================================

  describe('3. Admin Driver Verification & Governance', () => {
    let driver1ProfileId: string;
    let driver1DocId: string;

    beforeAll(async () => {
      const driver = await prisma.driverProfile.findUnique({
        where: { userId: driver1User.id },
      });
      driver1ProfileId = driver!.id.toString();

      const doc = await prisma.driverDocument.findFirst({
        where: { driverId: driver!.id, documentType: 'DRIVING_LICENCE' },
      });
      driver1DocId = doc!.id.toString();
    });

    it('GET /api/v1/admin/drivers/pending should list submitted driver in pending queue', async () => {
      const res = await request(app)
        .get('/api/v1/admin/drivers/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const found = res.body.data.some((d: any) => d.id === driver1ProfileId);
      expect(found).toBe(true);
    });

    it('GET /api/v1/admin/drivers/:id should return complete driver dossier with KYC evaluation', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/drivers/${driver1ProfileId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Rajesh');
      expect(res.body.data.kycEvaluation).toBeDefined();
    });

    it('GET /api/v1/admin/drivers/documents/:docId/file should stream document for admin inspection', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/drivers/documents/${driver1DocId}/file`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/png/i);
    });

    it('POST /api/v1/admin/drivers/:id/approve should fail if mandatory docs are not verified (fail-closed)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/mandatory/i);
    });

    it('POST /api/v1/admin/drivers/documents/:docId/verify should verify driver document', async () => {
      // Verify all mandatory documents for Driver 1
      const docs = await prisma.driverDocument.findMany({
        where: { driverId: BigInt(driver1ProfileId) },
      });

      for (const d of docs) {
        const res = await request(app)
          .post(`/api/v1/admin/drivers/documents/${d.id.toString()}/verify`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.verificationStatus).toBe('VERIFIED');
      }
    });

    it('POST /api/v1/admin/drivers/documents/:docId/verify should block self-verification with 403', async () => {
      // Provision driver profile for AdminDriverUser
      const admDrvProf = await prisma.driverProfile.create({
        data: {
          userId: adminDriverUser.id,
          firstName: 'AdminSelf',
          lastName: 'Driver',
          submissionStatus: 'SUBMITTED',
          approvalStatus: 'PENDING',
        },
      });

      const admDoc = await prisma.driverDocument.create({
        data: {
          driverId: admDrvProf.id,
          documentType: 'DRIVING_LICENCE',
          documentStorageKey: 'drivers/test.png',
          verificationStatus: 'PENDING',
        },
      });

      const res = await request(app)
        .post(`/api/v1/admin/drivers/documents/${admDoc.id.toString()}/verify`)
        .set('Authorization', `Bearer ${adminDriverToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot verify documents for their own/i);
    });

    it('POST /api/v1/admin/drivers/:id/approve should approve driver when all documents are verified', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.approvalStatus).toBe('APPROVED');
      expect(res.body.data.isActive).toBe(true);
    });

    it('POST /api/v1/admin/drivers/:id/suspend should suspend driver and cancel shifts', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Compliance investigation on speed violation report' });

      expect(res.status).toBe(200);
      expect(res.body.data.approvalStatus).toBe('SUSPENDED');
    });

    it('POST /api/v1/admin/drivers/:id/reactivate should revalidate KYC and restore APPROVED', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/drivers/${driver1ProfileId}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.approvalStatus).toBe('APPROVED');
    });
  });

  // ==========================================================================
  // 4. Fleet Partner Invitations & Affiliations
  // ==========================================================================

  describe('4. Partner Fleet Driver Invitations & Affiliations', () => {
    let invitationId: string;
    let invitationToken: string;
    let affiliationId: string;

    it('POST /api/v1/partners/drivers/invitations should send an invitation to Driver 1', async () => {
      const res = await request(app)
        .post('/api/v1/partners/drivers/invitations')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          invitedMobile: MOB_DRIVER_1,
          driverName: 'Rajesh Kumar',
          notes: 'Joining morning shift fleet',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invitedMobile).toBe(MOB_DRIVER_1);
      expect(res.body.data.invitationStatus).toBe('PENDING');
      invitationId = res.body.data.id;

      // Fetch the token directly from DB for public inspection test
      const invDb = await prisma.driverInvitation.findUnique({
        where: { id: BigInt(invitationId) },
      });
      invitationToken = invDb!.invitationToken;
    });

    it('GET /api/v1/drivers/invitations/public/:token should return public details without auth', async () => {
      const res = await request(app).get(
        `/api/v1/drivers/invitations/public/${invitationToken}`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.partnerBusinessName).toBe('Apex Fleet Logistics');
    });

    it('GET /api/v1/partners/drivers/invitations should list partner invitations', async () => {
      const res = await request(app)
        .get('/api/v1/partners/drivers/invitations')
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('Cross-partner security: Partner B attempting to access Partner A invitation should get 403', async () => {
      const res = await request(app)
        .get(`/api/v1/partners/drivers/invitations/${invitationId}`)
        .set('Authorization', `Bearer ${partnerBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission/i);
    });

    it('GET /api/v1/drivers/invitations should list invitation for Driver 1', async () => {
      const res = await request(app)
        .get('/api/v1/drivers/invitations')
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(200);
      const found = res.body.data.some((inv: any) => inv.id === invitationId);
      expect(found).toBe(true);
    });

    it('POST /api/v1/drivers/invitations/:id/accept should establish active affiliation', async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/invitations/${invitationId}/accept`)
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invitation.invitationStatus).toBe('ACCEPTED');
      expect(res.body.data.affiliationId).toBeDefined();
      affiliationId = res.body.data.affiliationId;
    });

    it('GET /api/v1/drivers/affiliations should list active affiliations for Driver 1', async () => {
      const res = await request(app)
        .get('/api/v1/drivers/affiliations')
        .set('Authorization', `Bearer ${driver1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].partnerBusinessName).toBe('Apex Fleet Logistics');
    });

    it('GET /api/v1/partners/drivers/affiliations should list affiliated drivers for Partner A', async () => {
      const res = await request(app)
        .get('/api/v1/partners/drivers/affiliations')
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].driverName).toMatch(/Rajesh/i);
    });

    it('Partner A sends invitation to Driver 2 and revokes it before acceptance', async () => {
      const createRes = await request(app)
        .post('/api/v1/partners/drivers/invitations')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ invitedMobile: MOB_DRIVER_2 });

      expect(createRes.status).toBe(201);
      const inv2Id = createRes.body.data.id;

      const revokeRes = await request(app)
        .post(`/api/v1/partners/drivers/invitations/${inv2Id}/revoke`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ reason: 'Position filled by another driver' });

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.data.invitationStatus).toBe('REVOKED');
    });
  });

  // ==========================================================================
  // 5. Shift Scheduling, Lifecycle & Operational Execution
  // ==========================================================================

  describe('5. Shift Scheduling, Start, Completion & Cancellation', () => {
    let driver1Profile: any;
    let assignmentId: string;

    beforeAll(async () => {
      driver1Profile = await prisma.driverProfile.findUnique({
        where: { userId: driver1User.id },
      });
    });

    it('POST /api/v1/partners/drivers/assignments should schedule a shift successfully', async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 10 * 60 * 1000).toISOString(); // 10 mins from now
      const endTime = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(); // 8 hrs from now

      const res = await request(app)
        .post('/api/v1/partners/drivers/assignments')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          driverId: driver1Profile.id.toString(),
          vehicleId: testVehiclePartnerA.id.toString(),
          startTime,
          endTime,
          notes: 'Morning shift Bangalore Central',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.assignmentStatus).toBe('SCHEDULED');
      assignmentId = res.body.data.id;
    });

    it('POST /api/v1/partners/drivers/assignments should reject overlapping shift with 409', async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      const endTime = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .post('/api/v1/partners/drivers/assignments')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          driverId: driver1Profile.id.toString(),
          vehicleId: testVehiclePartnerA.id.toString(),
          startTime,
          endTime,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/overlap|conflict/i);
    });

    it('POST /api/v1/drivers/assignments/:id/start-shift should start shift with possession check', async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/assignments/${assignmentId}/start-shift`)
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({
          confirmVehiclePossession: true,
          initialOdometerReading: 12500,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.assignmentStatus).toBe('ACTIVE');

      // Verify driver duty status is now ONLINE
      const avail = await prisma.driverAvailability.findUnique({
        where: { driverId: driver1Profile.id },
      });
      expect(avail?.isOnline).toBe(true);
    });

    it('POST /api/v1/drivers/heartbeat should update location and keep-alive', async () => {
      const res = await request(app)
        .post('/api/v1/drivers/heartbeat')
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({
          latitude: 12.9716,
          longitude: 77.5946,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.lastHeartbeatAt).toBeDefined();
      expect(res.body.data.isOnline).toBe(true);
    });

    it('PATCH /api/v1/drivers/duty-status should reject going offline during active shift with 409', async () => {
      const res = await request(app)
        .patch('/api/v1/drivers/duty-status')
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({ isOnline: false });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/active shift/i);
    });

    it('POST /api/v1/drivers/assignments/:id/complete-shift should complete shift and set offline', async () => {
      const res = await request(app)
        .post(`/api/v1/drivers/assignments/${assignmentId}/complete-shift`)
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({ notes: 'Shift concluded without incidents' });

      expect(res.status).toBe(200);
      expect(res.body.data.assignmentStatus).toBe('COMPLETED');
    });

    it('PATCH /api/v1/drivers/duty-status should toggle duty status after shift completion', async () => {
      const res = await request(app)
        .patch('/api/v1/drivers/duty-status')
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({ isOnline: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isOnline).toBe(true);
    });

    it('Short-notice cancellation workflow: Driver cancels within 2h -> blocked with 422 -> Partner approves cancellation', async () => {
      // 1. Schedule a new shift starting 30 mins from now
      const now = new Date();
      const startTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      const endTime = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();

      const schedRes = await request(app)
        .post('/api/v1/partners/drivers/assignments')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          driverId: driver1Profile.id.toString(),
          vehicleId: testVehiclePartnerA.id.toString(),
          startTime,
          endTime,
        });

      expect(schedRes.status).toBe(201);
      const cancelShiftId = schedRes.body.data.id;

      // 2. Driver initiates cancellation within 2 hours -> blocked with 422 requiring owner approval
      const cancelRes = await request(app)
        .post(`/api/v1/drivers/assignments/${cancelShiftId}/cancel-shift`)
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({ reason: 'Medical emergency in family' });

      expect(cancelRes.status).toBe(422);
      expect(cancelRes.body.message).toMatch(/within 2 hours/i);

      // 3. Partner explicitly approves late cancellation
      const approveRes = await request(app)
        .post(`/api/v1/partners/drivers/assignments/${cancelShiftId}/approve-cancellation`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          driverCancellationReason: 'Medical emergency in family',
          ownerApprovalNotes: 'Approved with fee waiver on compassionate grounds',
        });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.assignmentStatus).toBe('CANCELLED');
    });
  });
});
