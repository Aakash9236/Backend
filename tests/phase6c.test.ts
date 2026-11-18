import request from 'supertest';
import path from 'path';
import fs from 'fs';
import app from '../src/app';
import { prisma, disconnectDatabase } from '../src/config/db.config';
import { TokenUtil } from '../src/common/utils/token.util';
import { UserRole } from '../src/common/constants';
import { DateUtil } from '../src/common/utils/date.util';
import { defaultVehicleKycPolicyProvider } from '../src/modules/vehicles/services/vehicle-kyc.service';

describe('Phase 6C: Vehicle Ownership & Fleet Management Verification', () => {
  const MOB_PARTNER_A = '+919999444001';
  const MOB_PARTNER_B = '+919999444002';
  const MOB_ADMIN = '+919999444003';
  const MOB_SUPER_ADMIN = '+919999444004';
  const MOB_DUAL_ADMIN_PARTNER = '+919999444005';

  let partnerAToken: string;
  let partnerAUserId: bigint;
  let partnerAProfileId: bigint;

  let partnerBToken: string;
  let partnerBUserId: bigint;
  let partnerBProfileId: bigint;

  let adminToken: string;
  let adminUserId: bigint;

  let superAdminToken: string;
  let superAdminUserId: bigint;

  let dualAdminPartnerToken: string;
  let dualAdminUserId: bigint;
  let dualAdminPartnerProfileId: bigint;

  let testVehicleTypeId: bigint;
  let samplePdfPath: string;

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

    const currentRoles = await prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });
    const rolesList = currentRoles.map((r) => r.role.roleName);

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
      roles: rolesList,
      activeRole: activeRole || rolesList[0],
      sessionId: session.id.toString(),
    });

    return { user, token: accessToken, session, refreshToken: rawRefreshToken };
  };

  const cleanupData = async () => {
    try {
      defaultVehicleKycPolicyProvider.clearRules();

      const testMobiles = [
        MOB_PARTNER_A,
        MOB_PARTNER_B,
        MOB_ADMIN,
        MOB_SUPER_ADMIN,
        MOB_DUAL_ADMIN_PARTNER,
      ];

      const users = await prisma.user.findMany({
        where: { mobileNumber: { in: testMobiles } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        const partners = await prisma.partnerProfile.findMany({
          where: { userId: { in: userIds } },
          select: { id: true },
        });
        const partnerIds = partners.map((p) => p.id);

        if (partnerIds.length > 0) {
          const partnerVehicles = await prisma.partnerVehicle.findMany({
            where: { partnerId: { in: partnerIds } },
            select: { vehicleId: true },
          });
          const vehicleIds = partnerVehicles.map((pv) => pv.vehicleId);

          if (vehicleIds.length > 0) {
            await prisma.vehicleDocument.deleteMany({
              where: { vehicleId: { in: vehicleIds } },
            });
            await prisma.partnerVehicle.deleteMany({
              where: { vehicleId: { in: vehicleIds } },
            });
            await prisma.auditLog.deleteMany({
              where: {
                entityName: { in: ['vehicles', 'vehicle_documents', 'partner_vehicles'] },
                entityId: { in: vehicleIds },
              },
            });
            await prisma.vehicle.deleteMany({
              where: { id: { in: vehicleIds } },
            });
          }

          await prisma.partnerDocument.deleteMany({
            where: { partnerId: { in: partnerIds } },
          });
          await prisma.partnerProfile.deleteMany({
            where: { id: { in: partnerIds } },
          });
        }

        await prisma.auditLog.deleteMany({
          where: { actorUserId: { in: userIds } },
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
    } catch (err) {
      console.error('Error during cleanup:', err);
    }
  };

  beforeAll(async () => {
    await cleanupData();

    // Create a temporary sample PDF for testing uploads
    samplePdfPath = path.join(__dirname, 'test_sample.pdf');
    fs.writeFileSync(samplePdfPath, '%PDF-1.4 test document content for vehicle kyc');

    // Get an existing vehicle type or create one
    let vt = await prisma.vehicleType.findFirst({ where: { isActive: true } });
    if (!vt) {
      let cat = await prisma.serviceCategory.findFirst();
      if (!cat) {
        cat = await prisma.serviceCategory.create({
          data: {
            categoryCode: 'SHIFTING_TEST',
            categoryName: 'Shifting Test Category',
          },
        });
      }
      vt = await prisma.vehicleType.create({
        data: {
          serviceCategoryId: cat.id,
          typeCode: 'TATA_ACE_TEST',
          typeName: 'Tata Ace Test',
          capacityKg: 850,
          isActive: true,
        },
      });
    }
    testVehicleTypeId = vt.id;

    // 1. Partner A
    const resA = await setupTestUser(MOB_PARTNER_A, [UserRole.PARTNER], UserRole.PARTNER);
    partnerAUserId = resA.user.id;
    const profA = await prisma.partnerProfile.create({
      data: {
        userId: partnerAUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Partner A Fleet Owner',
        approvalStatus: 'APPROVED',
      },
    });
    partnerAProfileId = profA.id;
    partnerAToken = resA.token;

    // 2. Partner B
    const resB = await setupTestUser(MOB_PARTNER_B, [UserRole.PARTNER], UserRole.PARTNER);
    partnerBUserId = resB.user.id;
    const profB = await prisma.partnerProfile.create({
      data: {
        userId: partnerBUserId,
        profileType: 'BUSINESS',
        legalName: 'Partner B Logistics Ltd',
        approvalStatus: 'APPROVED',
      },
    });
    partnerBProfileId = profB.id;
    partnerBToken = resB.token;

    // 3. Admin
    const resAdmin = await setupTestUser(MOB_ADMIN, [UserRole.ADMIN], UserRole.ADMIN);
    adminUserId = resAdmin.user.id;
    adminToken = resAdmin.token;

    // 4. Super Admin
    const resSuper = await setupTestUser(MOB_SUPER_ADMIN, [UserRole.SUPER_ADMIN], UserRole.SUPER_ADMIN);
    superAdminUserId = resSuper.user.id;
    superAdminToken = resSuper.token;

    // 5. Dual Admin + Partner (for testing self-approval prevention)
    const resDual = await setupTestUser(
      MOB_DUAL_ADMIN_PARTNER,
      [UserRole.ADMIN, UserRole.PARTNER],
      UserRole.PARTNER
    );
    dualAdminUserId = resDual.user.id;
    const profDual = await prisma.partnerProfile.create({
      data: {
        userId: dualAdminUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Dual Admin Partner',
        approvalStatus: 'APPROVED',
      },
    });
    dualAdminPartnerProfileId = profDual.id;
    dualAdminPartnerToken = resDual.token;
  });

  afterAll(async () => {
    if (fs.existsSync(samplePdfPath)) {
      try {
        fs.unlinkSync(samplePdfPath);
      } catch {}
    }
    await cleanupData();
    await disconnectDatabase();
  });

  describe('1. Vehicle Types Catalog', () => {
    it('GET /api/v1/partners/vehicles/types - should return active vehicle types', async () => {
      const res = await request(app)
        .get('/api/v1/partners/vehicles/types')
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('typeCode');
      expect(res.body.data[0]).toHaveProperty('displayName');
      expect(res.body.data[0]).toHaveProperty('capacityKg');
    });

    it('GET /api/v1/vehicles/types - public alias should also return vehicle types', async () => {
      const res = await request(app).get('/api/v1/vehicles/types');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('2. Vehicle Registration & Ownership', () => {
    let createdVehicleId: string;

    it('POST /api/v1/partners/vehicles - should register a new vehicle as OWNER and set isPrimary: true', async () => {
      const res = await request(app)
        .post('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          vehicleTypeId: testVehicleTypeId.toString(),
          registrationNumber: 'ka-01-ab-1234', // test lowercase normalization
          make: 'Tata',
          model: 'Ace Gold',
          manufacturingYear: 2022,
          rcNumber: 'RC-KA-01-AB-1234',
          ownershipType: 'OWNER',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.registrationNumber).toBe('KA01AB1234'); // normalized
      expect(res.body.data.verificationStatus).toBe('PENDING');
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data.ownership.ownershipType).toBe('OWNER');
      expect(res.body.data.ownership.isPrimary).toBe(true); // first vehicle is automatically primary
      expect(res.body.data.operationalStatus).toBe(false); // pending vehicle is not operational
      createdVehicleId = res.body.data.id;
    });

    it('POST /api/v1/partners/vehicles - duplicate active registration must be rejected with 409 Conflict', async () => {
      // Partner A registers again
      const resA = await request(app)
        .post('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          vehicleTypeId: testVehicleTypeId.toString(),
          registrationNumber: 'KA-01-AB-1234',
          ownershipType: 'OWNER',
        });

      expect(resA.status).toBe(409);
      expect(resA.body.message).toContain('already registered');

      // Partner B tries to register the same vehicle while it is actively held by Partner A
      const resB = await request(app)
        .post('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerBToken}`)
        .send({
          vehicleTypeId: testVehicleTypeId.toString(),
          registrationNumber: 'KA01AB1234',
          ownershipType: 'OWNER',
        });

      expect(resB.status).toBe(409);
      expect(resB.body.message).toContain('already actively registered');
    });

    it('POST /api/v1/partners/vehicles - should mandate ownerName when ownershipType is AUTHORIZED_REPRESENTATIVE', async () => {
      const res = await request(app)
        .post('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          vehicleTypeId: testVehicleTypeId.toString(),
          registrationNumber: 'KA-02-CD-5678',
          ownershipType: 'AUTHORIZED_REPRESENTATIVE',
          // ownerName missing!
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Request validation failed');
    });

    it('POST /api/v1/partners/vehicles - should register vehicle with AUTHORIZED_REPRESENTATIVE when ownerName is provided', async () => {
      const res = await request(app)
        .post('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          vehicleTypeId: testVehicleTypeId.toString(),
          registrationNumber: 'KA-02-CD-5678',
          ownershipType: 'AUTHORIZED_REPRESENTATIVE',
          ownerName: 'Original Registered Owner Name',
          make: 'Mahindra',
          model: 'Bolero Maxi Truck',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ownership.ownershipType).toBe('AUTHORIZED_REPRESENTATIVE');
      expect(res.body.data.ownership.ownerName).toBe('Original Registered Owner Name');
      expect(res.body.data.ownership.isPrimary).toBe(false); // second vehicle is not primary by default
    });
  });

  describe('3. Fleet Listing, Primary Vehicle & Active Status', () => {
    let vehicleA1Id: string;
    let vehicleA2Id: string;

    beforeAll(async () => {
      const list = await request(app)
        .get('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`);
      vehicleA1Id = list.body.data[0].id;
      vehicleA2Id = list.body.data[1].id;
    });

    it('GET /api/v1/partners/vehicles - should list all vehicles in partner fleet', async () => {
      const res = await request(app)
        .get('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.totalVehicles).toBe(2);
    });

    it('PATCH /api/v1/partners/vehicles/:id/primary - should switch primary vehicle', async () => {
      // Make second vehicle primary
      const res = await request(app)
        .patch(`/api/v1/partners/vehicles/${vehicleA2Id}/primary`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ownership.isPrimary).toBe(true);

      // Verify that vehicleA1 is no longer primary
      const resA1 = await request(app)
        .get(`/api/v1/partners/vehicles/${vehicleA1Id}`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(resA1.body.data.ownership.isPrimary).toBe(false);
    });

    it('PATCH /api/v1/partners/vehicles/:id/status - should toggle vehicle active status', async () => {
      const resDeactivate = await request(app)
        .patch(`/api/v1/partners/vehicles/${vehicleA1Id}/status`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ isActive: false });

      expect(resDeactivate.status).toBe(200);
      expect(resDeactivate.body.data.isActive).toBe(false);

      const resReactivate = await request(app)
        .patch(`/api/v1/partners/vehicles/${vehicleA1Id}/status`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ isActive: true });

      expect(resReactivate.status).toBe(200);
      expect(resReactivate.body.data.isActive).toBe(true);
    });

    it('Tenant Isolation: Partner B cannot access or modify Partner A vehicle', async () => {
      const resGet = await request(app)
        .get(`/api/v1/partners/vehicles/${vehicleA1Id}`)
        .set('Authorization', `Bearer ${partnerBToken}`);

      expect(resGet.status).toBe(404);

      const resPrimary = await request(app)
        .patch(`/api/v1/partners/vehicles/${vehicleA1Id}/primary`)
        .set('Authorization', `Bearer ${partnerBToken}`);

      expect(resPrimary.status).toBe(404);
    });
  });

  describe('4. Document Upload, Replacement Immutability & Expiry Validation', () => {
    let targetVehicleId: string;
    let initialDocId: string;
    let replacedDocId: string;

    beforeAll(async () => {
      const list = await request(app)
        .get('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`);
      targetVehicleId = list.body.data[0].id;
    });

    it('POST /api/v1/partners/vehicles/:id/documents - should upload RC document', async () => {
      // Expiry far in future: 2028-12-31
      const res = await request(app)
        .post(`/api/v1/partners/vehicles/${targetVehicleId}/documents`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .field('documentType', 'RC')
        .field('expiryDate', '2028-12-31')
        .attach('file', samplePdfPath);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.documentType).toBe('RC');
      expect(res.body.data.verificationStatus).toBe('PENDING');
      expect(res.body.data.isExpired).toBe(false);
      expect(res.body.data.isExpiringSoon).toBe(false);
      initialDocId = res.body.data.id;
    });

    it('Document Replacement Immutability: Uploading new RC creates a NEW record, old is preserved', async () => {
      const res = await request(app)
        .post(`/api/v1/partners/vehicles/${targetVehicleId}/documents`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .field('documentType', 'RC')
        .field('expiryDate', '2029-06-30')
        .attach('file', samplePdfPath);

      expect(res.status).toBe(201);
      expect(res.body.data.documentType).toBe('RC');
      replacedDocId = res.body.data.id;
      expect(replacedDocId).not.toBe(initialDocId);

      // Verify in DB that both rows exist
      const allRcDocs = await prisma.vehicleDocument.findMany({
        where: { vehicleId: BigInt(targetVehicleId), documentType: 'RC' },
        orderBy: { uploadedAt: 'desc' },
      });

      expect(allRcDocs.length).toBe(2);
      expect(allRcDocs[0].id.toString()).toBe(replacedDocId);
      expect(allRcDocs[1].id.toString()).toBe(initialDocId);
    });

    it('Calendar-day Expiry Validation: Expired document immediately flags isExpired: true and operationalStatus: false', async () => {
      // Upload INSURANCE expired yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const res = await request(app)
        .post(`/api/v1/partners/vehicles/${targetVehicleId}/documents`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .field('documentType', 'INSURANCE')
        .field('expiryDate', yesterdayStr)
        .attach('file', samplePdfPath);

      expect(res.status).toBe(201);
      expect(res.body.data.isExpired).toBe(true);
      expect(res.body.data.isExpiringSoon).toBe(false);

      // Check vehicle details
      const vehicleRes = await request(app)
        .get(`/api/v1/partners/vehicles/${targetVehicleId}`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(vehicleRes.body.data.hasExpiredDocuments).toBe(true);
      expect(vehicleRes.body.data.operationalStatus).toBe(false);
    });

    it('Calendar-day Expiry Validation: 15-day warning window flags isExpiringSoon: true', async () => {
      // Upload FITNESS expiring in 7 days
      const future7 = new Date();
      future7.setDate(future7.getDate() + 7);
      const future7Str = future7.toISOString().split('T')[0];

      const res = await request(app)
        .post(`/api/v1/partners/vehicles/${targetVehicleId}/documents`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .field('documentType', 'FITNESS')
        .field('expiryDate', future7Str)
        .attach('file', samplePdfPath);

      expect(res.status).toBe(201);
      expect(res.body.data.isExpired).toBe(false);
      expect(res.body.data.isExpiringSoon).toBe(true);
      expect(res.body.data.daysRemaining).toBeLessThanOrEqual(7);
      expect(res.body.data.daysRemaining).toBeGreaterThanOrEqual(6);
    });

    it('Calendar-day Expiry Validation: Document expiring today is valid through 23:59:59 (isExpired: false)', async () => {
      const todayStr = new Date().toISOString().split('T')[0];

      const res = await request(app)
        .post(`/api/v1/partners/vehicles/${targetVehicleId}/documents`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .field('documentType', 'POLLUTION_PUC')
        .field('expiryDate', todayStr)
        .attach('file', samplePdfPath);

      expect(res.status).toBe(201);
      expect(res.body.data.isExpired).toBe(false);
      expect(res.body.data.isExpiringSoon).toBe(true); // 0 days remaining <= 15 days
    });

    it('Secure Document Streaming: Partner can stream their uploaded document with safe security headers', async () => {
      const res = await request(app)
        .get(`/api/v1/partners/vehicles/${targetVehicleId}/documents/${replacedDocId}/file`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
    });

    it('Secure Document Streaming: Partner B cannot stream Partner A vehicle document', async () => {
      const res = await request(app)
        .get(`/api/v1/partners/vehicles/${targetVehicleId}/documents/${replacedDocId}/file`)
        .set('Authorization', `Bearer ${partnerBToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('5. Admin Vehicle Governance & Document Verification', () => {
    let vehicleId: string;
    let docRcId: string;
    let docInsId: string;
    let docFitId: string;
    let docPucId: string;

    beforeAll(async () => {
      // Create a fresh vehicle for Admin governance testing
      const res = await request(app)
        .post('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          vehicleTypeId: testVehicleTypeId.toString(),
          registrationNumber: 'KA-05-MN-9999',
          ownershipType: 'OWNER',
          make: 'Ashok Leyland',
          model: 'Dost+',
        });

      vehicleId = res.body.data.id;

      // Upload valid future documents: RC, INSURANCE, FITNESS, POLLUTION_PUC
      const uploadDoc = async (type: string) => {
        const r = await request(app)
          .post(`/api/v1/partners/vehicles/${vehicleId}/documents`)
          .set('Authorization', `Bearer ${partnerAToken}`)
          .field('documentType', type)
          .field('expiryDate', '2028-12-31')
          .attach('file', samplePdfPath);
        return r.body.data.id;
      };

      docRcId = await uploadDoc('RC');
      docInsId = await uploadDoc('INSURANCE');
      docFitId = await uploadDoc('FITNESS');
      docPucId = await uploadDoc('POLLUTION_PUC');
    });

    it('GET /api/v1/admin/vehicles/pending - should list vehicle in pending review queue', async () => {
      const res = await request(app)
        .get('/api/v1/admin/vehicles/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const item = res.body.data.find((v: any) => v.id === vehicleId);
      expect(item).toBeDefined();
      expect(item.registrationNumber).toBe('KA05MN9999');
      expect(item.verificationStatus).toBe('PENDING');
    });

    it('GET /api/v1/admin/vehicles/:id - should return complete vehicle dossier with KYC evaluation', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.vehicle.id).toBe(vehicleId);
      expect(res.body.data.kycEvaluation).toBeDefined();
      expect(res.body.data.kycEvaluation.isKycComplete).toBe(false); // documents not verified yet
      expect(res.body.data.documents.length).toBe(4);
    });

    it('POST /api/v1/admin/vehicles/documents/:docId/reject - reject document with mandatory reason', async () => {
      // Rejection without reason fails
      const failRes = await request(app)
        .post(`/api/v1/admin/vehicles/documents/${docRcId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: '' });
      expect(failRes.status).toBe(422);

      // Rejection with valid reason
      const res = await request(app)
        .post(`/api/v1/admin/vehicles/documents/${docRcId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'RC document image is blurred and unreadable' });

      expect(res.status).toBe(200);
      expect(res.body.data.verificationStatus).toBe('REJECTED');
      expect(res.body.data.rejectionReason).toBe('RC document image is blurred and unreadable');
    });

    it('POST /api/v1/admin/vehicles/:id/approve - fail-closed gate blocks approval when documents are rejected/unverified', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/vehicles/${vehicleId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Vehicle approval gate failed');
      expect(res.body.message).toContain('RC');
    });

    it('Upload new RC document and verify all documents', async () => {
      // Partner re-uploads clean RC
      const uploadRes = await request(app)
        .post(`/api/v1/partners/vehicles/${vehicleId}/documents`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .field('documentType', 'RC')
        .field('expiryDate', '2028-12-31')
        .attach('file', samplePdfPath);

      const newRcId = uploadRes.body.data.id;

      // Admin verifies all 4 documents
      for (const dId of [newRcId, docInsId, docFitId, docPucId]) {
        const verifyRes = await request(app)
          .post(`/api/v1/admin/vehicles/documents/${dId}/verify`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.data.verificationStatus).toBe('VERIFIED');
      }
    });

    it('POST /api/v1/admin/vehicles/:id/approve - succeeds once all mandatory documents are verified', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/vehicles/${vehicleId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.vehicle.verificationStatus).toBe('VERIFIED');
      expect(res.body.data.vehicle.operationalStatus).toBe(true);
    });

    it('POST /api/v1/admin/vehicles/:id/suspend - suspends verified vehicle with mandatory reason', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/vehicles/${vehicleId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Vehicle involved in traffic safety violation' });

      expect(res.status).toBe(200);
      expect(res.body.data.vehicle.verificationStatus).toBe('SUSPENDED');
      expect(res.body.data.vehicle.operationalStatus).toBe(false);
    });

    it('POST /api/v1/admin/vehicles/:id/reactivate - reactivates suspended vehicle', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/vehicles/${vehicleId}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.vehicle.verificationStatus).toBe('VERIFIED');
      expect(res.body.data.vehicle.operationalStatus).toBe(true);
    });

    it('Secure Document Streaming: Admin can stream vehicle document file', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/vehicles/documents/${docInsId}/file`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-type']).toContain('application/pdf');
    });

    it('Self-approval prevention: Admin cannot approve or suspend vehicles registered to their own partner account', async () => {
      // Dual admin-partner registers a vehicle
      const regRes = await request(app)
        .post('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${dualAdminPartnerToken}`)
        .send({
          vehicleTypeId: testVehicleTypeId.toString(),
          registrationNumber: 'KA-09-ZZ-0001',
          ownershipType: 'OWNER',
        });
      const dualVehicleId = regRes.body.data.id;

      // Now this user switches role to ADMIN and attempts to approve their own vehicle
      const adminRes = await setupTestUser(
        MOB_DUAL_ADMIN_PARTNER,
        [UserRole.ADMIN, UserRole.PARTNER],
        UserRole.ADMIN
      );

      const approveRes = await request(app)
        .post(`/api/v1/admin/vehicles/${dualVehicleId}/approve`)
        .set('Authorization', `Bearer ${adminRes.token}`);

      expect(approveRes.status).toBe(403);
      expect(approveRes.body.message).toContain('own partner account');
    });
  });

  describe('6. Vehicle Ownership Transfer (Super Admin Only)', () => {
    let transferVehicleId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          vehicleTypeId: testVehicleTypeId.toString(),
          registrationNumber: 'KA-08-TR-1000',
          ownershipType: 'OWNER',
          make: 'Eicher',
          model: 'Pro 2049',
        });
      transferVehicleId = res.body.data.id;
    });

    it('POST /api/v1/admin/vehicles/:id/transfer - non-super-admin is forbidden (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/vehicles/${transferVehicleId}/transfer`)
        .set('Authorization', `Bearer ${adminToken}`) // standard ADMIN
        .send({
          targetPartnerId: partnerBProfileId.toString(),
          transferReason: 'Selling vehicle fleet to partner B',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('SUPER_ADMIN');
    });

    it('POST /api/v1/admin/vehicles/:id/transfer - Super Admin transfers ownership: closes previous, creates new active, resets to PENDING', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/vehicles/${transferVehicleId}/transfer`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          targetPartnerId: partnerBProfileId.toString(),
          transferReason: 'Fleet acquisition approved by management',
          newOwnershipType: 'OWNER',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.formerPartnerId).toBe(partnerAProfileId.toString());
      expect(res.body.data.newPartnerId).toBe(partnerBProfileId.toString());

      // 1. Verify previous relationship is preserved with TRANSFERRED and unassigned_at populated
      const prevRel = await prisma.partnerVehicle.findFirst({
        where: {
          vehicleId: BigInt(transferVehicleId),
          partnerId: partnerAProfileId,
        },
      });
      expect(prevRel).toBeDefined();
      expect(prevRel!.ownershipStatus).toBe('TRANSFERRED');
      expect(prevRel!.unassignedAt).not.toBeNull();

      // 2. Verify new relationship is ACTIVE
      const newRel = await prisma.partnerVehicle.findFirst({
        where: {
          vehicleId: BigInt(transferVehicleId),
          partnerId: partnerBProfileId,
        },
      });
      expect(newRel).toBeDefined();
      expect(newRel!.ownershipStatus).toBe('ACTIVE');
      expect(newRel!.unassignedAt).toBeNull();

      // 3. Verify vehicle verificationStatus was reset to PENDING
      const v = await prisma.vehicle.findUnique({
        where: { id: BigInt(transferVehicleId) },
      });
      expect(v!.verificationStatus).toBe('PENDING');

      // 4. Partner B can now see the vehicle in their fleet
      const partnerBList = await request(app)
        .get('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerBToken}`);
      const foundInB = partnerBList.body.data.find((item: any) => item.id === transferVehicleId);
      expect(foundInB).toBeDefined();

      // 5. Partner A no longer sees it as active
      const partnerAList = await request(app)
        .get('/api/v1/partners/vehicles')
        .set('Authorization', `Bearer ${partnerAToken}`);
      const foundInA = partnerAList.body.data.find((item: any) => item.id === transferVehicleId);
      expect(foundInA).toBeUndefined();
    });
  });

  describe('7. PostgreSQL Engine Constraints Verification (Live DB Integration)', () => {
    let testPartnerId: bigint;
    let testUserId: bigint;
    let vId1: bigint;
    let vId2: bigint;

    beforeAll(async () => {
      // Create isolated test user & partner for constraint testing
      const u = await prisma.user.create({
        data: {
          mobileNumber: '+919999555001',
          accountStatus: 'ACTIVE',
        },
      });
      testUserId = u.id;

      const p = await prisma.partnerProfile.create({
        data: {
          userId: u.id,
          legalName: 'Constraint Test Partner Profile',
          approvalStatus: 'APPROVED',
        },
      });
      testPartnerId = p.id;

      const vt = await prisma.vehicleType.findFirst({ where: { isActive: true } });
      const v1 = await prisma.vehicle.create({
        data: {
          vehicleTypeId: vt!.id,
          registrationNumber: 'KA04ENG001',
          verificationStatus: 'VERIFIED',
        },
      });
      const v2 = await prisma.vehicle.create({
        data: {
          vehicleTypeId: vt!.id,
          registrationNumber: 'KA04ENG002',
          verificationStatus: 'VERIFIED',
        },
      });
      vId1 = v1.id;
      vId2 = v2.id;
    });

    afterAll(async () => {
      await prisma.partnerVehicle.deleteMany({
        where: { vehicleId: { in: [vId1, vId2] } },
      });
      await prisma.vehicle.deleteMany({
        where: { id: { in: [vId1, vId2] } },
      });
      if (testPartnerId) {
        await prisma.partnerProfile.deleteMany({ where: { id: testPartnerId } });
      }
      if (testUserId) {
        await prisma.user.deleteMany({ where: { id: testUserId } });
      }
    });

    it('idx_one_primary_vehicle_per_partner: PostgreSQL engine rejects inserting second active primary vehicle for same partner', async () => {
      // 1. Insert first active primary vehicle directly
      await prisma.partnerVehicle.create({
        data: {
          partnerId: testPartnerId,
          vehicleId: vId1,
          isPrimary: true,
          ownershipStatus: 'ACTIVE',
          ownershipType: 'OWNER',
          unassignedAt: null,
        },
      });

      // 2. Attempt to insert second active primary vehicle directly in PostgreSQL bypassing application logic
      let rejected = false;
      try {
        await prisma.partnerVehicle.create({
          data: {
            partnerId: testPartnerId,
            vehicleId: vId2,
            isPrimary: true,
            ownershipStatus: 'ACTIVE',
            ownershipType: 'OWNER',
            unassignedAt: null,
          },
        });
      } catch (err: any) {
        rejected = true;
        expect(err.message).toContain('Unique constraint failed');
      }

      expect(rejected).toBe(true);

      // Clean up first test record
      await prisma.partnerVehicle.deleteMany({
        where: { partnerId: testPartnerId, vehicleId: vId1 },
      });
    });

    it('chk_active_ownership_unassigned_at: PostgreSQL engine rejects active record with non-null unassigned_at', async () => {
      let rejected = false;
      try {
        await prisma.partnerVehicle.create({
          data: {
            partnerId: testPartnerId,
            vehicleId: vId1,
            isPrimary: false,
            ownershipStatus: 'ACTIVE',
            ownershipType: 'OWNER',
            unassignedAt: new Date(), // VIOLATES CHECK CONSTRAINT!
          },
        });
      } catch (err: any) {
        rejected = true;
        // Verify PostgreSQL check constraint error (code 23514)
        expect(err.message).toContain('chk_active_ownership_unassigned_at');
      }

      expect(rejected).toBe(true);
    });

    it('chk_active_ownership_unassigned_at: PostgreSQL engine permits non-active record with unassigned_at populated', async () => {
      const transferredRel = await prisma.partnerVehicle.create({
        data: {
          partnerId: testPartnerId,
          vehicleId: vId1,
          isPrimary: false,
          ownershipStatus: 'TRANSFERRED',
          ownershipType: 'OWNER',
          unassignedAt: new Date(),
        },
      });

      expect(transferredRel).toBeDefined();
      expect(transferredRel.ownershipStatus).toBe('TRANSFERRED');
      expect(transferredRel.unassignedAt).not.toBeNull();

      // Clean up
      await prisma.partnerVehicle.deleteMany({
        where: { id: transferredRel.id },
      });
    });
  });

  describe('8. Asia/Kolkata Business Calendar Timezone Boundary Verification', () => {
    const expiryDateStr = '2026-11-05';

    it('Document remains valid until 23:59:59.999 IST on expiry date (Asia/Kolkata)', () => {
      // 23:59:59.999 IST on 2026-11-05 corresponds to 2026-11-05T18:29:59.999Z UTC
      const lastMillisecondOfExpiryDay = new Date('2026-11-05T18:29:59.999Z');
      const evalResult = DateUtil.evaluateCalendarExpiry(expiryDateStr, lastMillisecondOfExpiryDay);

      expect(evalResult.isExpired).toBe(false);
      expect(evalResult.daysRemaining).toBe(0);
      expect(evalResult.isExpiringSoon).toBe(true);
      expect(evalResult.formattedExpiry).toBe(expiryDateStr);
    });

    it('Document becomes EXPIRED at 00:00:00.000 IST on the subsequent day (zero grace period)', () => {
      // 00:00:00.000 IST on 2026-11-06 corresponds to 2026-11-05T18:30:00.000Z UTC
      const firstMillisecondOfNextDay = new Date('2026-11-05T18:30:00.000Z');
      const evalResult = DateUtil.evaluateCalendarExpiry(expiryDateStr, firstMillisecondOfNextDay);

      expect(evalResult.isExpired).toBe(true);
      expect(evalResult.daysRemaining).toBe(0);
      expect(evalResult.isExpiringSoon).toBe(false);
      expect(evalResult.warning).toBe('DOCUMENT_EXPIRED');
    });

    it('Start of expiry day at 00:00:00.000 IST is valid with 0 days remaining', () => {
      // 00:00:00.000 IST on 2026-11-05 corresponds to 2026-11-04T18:30:00.000Z UTC
      const startOfExpiryDay = new Date('2026-11-04T18:30:00.000Z');
      const evalResult = DateUtil.evaluateCalendarExpiry(expiryDateStr, startOfExpiryDay);

      expect(evalResult.isExpired).toBe(false);
      expect(evalResult.daysRemaining).toBe(0);
      expect(evalResult.isExpiringSoon).toBe(true);
    });

    it('15-day warning boundary: 15 calendar days remaining triggers DOCUMENT_EXPIRING_SOON', () => {
      // Reference date: 2026-10-21 12:00:00 IST -> 15 full calendar days before 2026-11-05
      const fifteenDaysBefore = new Date('2026-10-21T06:30:00.000Z');
      const evalResult = DateUtil.evaluateCalendarExpiry(expiryDateStr, fifteenDaysBefore);

      expect(evalResult.isExpired).toBe(false);
      expect(evalResult.daysRemaining).toBe(15);
      expect(evalResult.isExpiringSoon).toBe(true);
      expect(evalResult.warning).toBe('DOCUMENT_EXPIRING_SOON');
    });

    it('16-day boundary: 16 calendar days remaining does not trigger warning', () => {
      // Reference date: 2026-10-20 12:00:00 IST -> 16 full calendar days before 2026-11-05
      const sixteenDaysBefore = new Date('2026-10-20T06:30:00.000Z');
      const evalResult = DateUtil.evaluateCalendarExpiry(expiryDateStr, sixteenDaysBefore);

      expect(evalResult.isExpired).toBe(false);
      expect(evalResult.daysRemaining).toBe(16);
      expect(evalResult.isExpiringSoon).toBe(false);
      expect(evalResult.warning).toBeUndefined();
    });

    it('Machine local timezone independence: Explicit Asia/Kolkata business calendar comparisons', () => {
      // Ensure DateUtil.BUSINESS_TIMEZONE is explicitly configured as 'Asia/Kolkata'
      expect(DateUtil.BUSINESS_TIMEZONE).toBe('Asia/Kolkata');

      const parsed = DateUtil.parseCalendarDate('2026-11-05');
      expect(parsed.dateStr).toBe('2026-11-05');
      expect(parsed.year).toBe(2026);
      expect(parsed.month).toBe(11);
      expect(parsed.day).toBe(5);

      const startInstant = DateUtil.getStartOfKolkataDay('2026-11-05');
      expect(startInstant.toISOString()).toBe('2026-11-04T18:30:00.000Z');

      const endInstant = DateUtil.getEndOfKolkataDay('2026-11-05');
      expect(endInstant.toISOString()).toBe('2026-11-05T18:29:59.999Z');
    });
  });
});
