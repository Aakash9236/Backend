import express from 'express';
import request from 'supertest';
import { prisma } from '../src/config/db.config';
import { TokenUtil } from '../src/common/utils/token.util';
import { workerRoutes } from '../src/modules/workers/workers.routes';
import { errorHandler } from '../src/common/middlewares';
import { workerInvitationService } from '../src/modules/workers/services/worker-invitation.service';
import { workerOnboardingService } from '../src/modules/workers/services/worker-onboarding.service';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/v1/workers', workerRoutes);
app.use(errorHandler);

describe('Phase 6E Batch 5 — Step 2: Worker Self-Service HTTP API Integration', () => {
  // Mobile numbers for test isolation
  const MOB_WORKER_1 = '+919966000001';
  const MOB_WORKER_2 = '+919966000002';
  const MOB_CUSTOMER = '+919966000003';
  const MOB_PARTNER_A = '+919966000004';
  const MOB_PARTNER_B = '+919966000005';

  let worker1UserId: bigint;
  let worker1Token: string;

  let worker2UserId: bigint;
  let worker2Token: string;

  let customerUserId: bigint;
  let customerToken: string;

  let partnerAUserId: bigint;
  let partnerBUserId: bigint;

  let categoryId: bigint;

  const createdUserIds: bigint[] = [];

  // Helper to create user, roles, active session, and JWT token
  async function createTestUserWithSession(
    mobileNumber: string,
    roleNames: string[] = ['WORKER'],
    activeRole: string = 'WORKER'
  ) {
    let user = await prisma.user.findUnique({ where: { mobileNumber } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          mobileNumber,
          accountStatus: 'ACTIVE',
          isMobileVerified: true,
        },
      });
    }
    createdUserIds.push(user.id);

    for (const roleName of roleNames) {
      let role = await prisma.role.findUnique({ where: { roleName } });
      if (!role) {
        role = await prisma.role.create({
          data: { roleName, description: `${roleName} role` },
        });
      }
      const existingUserRole = await prisma.userRole.findUnique({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
      });
      if (!existingUserRole) {
        await prisma.userRole.create({
          data: { userId: user.id, roleId: role.id },
        });
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

    const token = TokenUtil.generateAccessToken({
      userId: user.id.toString(),
      mobileNumber: user.mobileNumber,
      roles: roleNames,
      activeRole,
      sessionId: session.id.toString(),
    });

    return { user, token, session };
  }

  beforeAll(async () => {
    // 1. Cleanup preexisting records for test mobiles
    const testMobiles = [
      MOB_WORKER_1,
      MOB_WORKER_2,
      MOB_CUSTOMER,
      MOB_PARTNER_A,
      MOB_PARTNER_B,
    ];
    const existingUsers = await prisma.user.findMany({
      where: { mobileNumber: { in: testMobiles } },
      select: { id: true },
    });
    const userIds = existingUsers.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.workerPartnerAffiliation.deleteMany({
        where: {
          OR: [
            { worker: { userId: { in: userIds } } },
            { partner: { userId: { in: userIds } } },
          ],
        },
      });
      await prisma.workerInvitation.deleteMany({
        where: {
          OR: [
            { partner: { userId: { in: userIds } } },
            { invitedMobile: { in: testMobiles } },
            { workerUserId: { in: userIds } },
          ],
        },
      });
      await prisma.workerAvailability.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerSkill.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerDocument.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerProfile.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.partnerProfile.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userSession.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { actorUserId: { in: userIds } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }

    // 2. Ensure Service Category exists
    let cat = await prisma.serviceCategory.findUnique({
      where: { categoryCode: 'ELEC_TEST' },
    });
    if (!cat) {
      cat = await prisma.serviceCategory.create({
        data: {
          categoryCode: 'ELEC_TEST',
          categoryName: 'Electrical Installation & Repair',
          isActive: true,
        },
      });
    }
    categoryId = cat.id;

    // 3. Create Partner A for invitation and affiliation tests
    const partnerAData = await createTestUserWithSession(MOB_PARTNER_A, ['PARTNER'], 'PARTNER');
    partnerAUserId = partnerAData.user.id;
    await prisma.partnerProfile.create({
      data: {
        userId: partnerAUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Apex Pro Services',
        businessName: 'Apex Pro',
        approvalStatus: 'APPROVED',
      },
    });

    // 4. Create Partner B for concurrent invitation tests
    const partnerBData = await createTestUserWithSession(MOB_PARTNER_B, ['PARTNER'], 'PARTNER');
    partnerBUserId = partnerBData.user.id;
    await prisma.partnerProfile.create({
      data: {
        userId: partnerBUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Nexus Home Care',
        businessName: 'Nexus Care',
        approvalStatus: 'APPROVED',
      },
    });

    // 5. Create Worker 1 (Main onboarding and self-service actor)
    const w1Data = await createTestUserWithSession(MOB_WORKER_1, ['WORKER'], 'WORKER');
    worker1UserId = w1Data.user.id;
    worker1Token = w1Data.token;

    // 6. Create Worker 2 (Secondary actor for IDOR testing)
    const w2Data = await createTestUserWithSession(MOB_WORKER_2, ['WORKER'], 'WORKER');
    worker2UserId = w2Data.user.id;
    worker2Token = w2Data.token;
    // Pre-initialize Worker 2 profile so Worker 2 is a valid worker entity for IDOR check
    await workerOnboardingService.getOrCreateProfile(worker2UserId);

    // 7. Create Customer (To verify 403 Forbidden for non-worker roles)
    const custData = await createTestUserWithSession(MOB_CUSTOMER, ['CUSTOMER'], 'CUSTOMER');
    customerUserId = custData.user.id;
    customerToken = custData.token;
  });

  afterAll(async () => {
    // Cleanup all created test data
    const userIds = [...new Set(createdUserIds)];
    if (userIds.length > 0) {
      await prisma.workerPartnerAffiliation.deleteMany({
        where: {
          OR: [
            { worker: { userId: { in: userIds } } },
            { partner: { userId: { in: userIds } } },
          ],
        },
      });
      await prisma.workerInvitation.deleteMany({
        where: {
          OR: [
            { partner: { userId: { in: userIds } } },
            { workerUserId: { in: userIds } },
          ],
        },
      });
      await prisma.workerAvailability.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerSkill.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerDocument.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerProfile.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.partnerProfile.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userSession.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { actorUserId: { in: userIds } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  });

  // ============================================================================
  // Suite 1: Authentication & Authorization Guards
  // ============================================================================

  describe('1. Authentication & RBAC Guards', () => {
    it('should reject request without Authorization header with 401', async () => {
      const res = await request(app).get('/api/v1/workers/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Authentication token missing/i);
    });

    it('should reject request with malformed token with 401', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me')
        .set('Authorization', 'Bearer invalid.token.payload');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-worker user (CUSTOMER) with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Access forbidden: You do not have the required role/i);
    });
  });

  // ============================================================================
  // Suite 2: Worker Profile & Onboarding Lifecycle
  // ============================================================================

  describe('2. Worker Profile & Onboarding APIs', () => {
    it('GET /me: should return or lazily initialize the worker profile', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me')
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.userId).toBe(worker1UserId.toString());
      expect(res.body.data.approvalStatus).toBe('PENDING');
      expect(res.body.data.submissionStatus).toBe('DRAFT');
    });

    it('PUT /me: should update worker profile details', async () => {
      const res = await request(app)
        .put('/api/v1/workers/me')
        .set('Authorization', `Bearer ${worker1Token}`)
        .send({
          firstName: 'Ramesh',
          lastName: 'Kumar',
          dateOfBirth: '1992-05-15',
          gender: 'MALE',
          bio: 'Experienced certified electrical technician with 8 years in residential systems.',
          experienceYears: 8,
          workerType: 'TECHNICIAN',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Ramesh');
      expect(res.body.data.lastName).toBe('Kumar');
      expect(res.body.data.workerType).toBe('TECHNICIAN');
      expect(res.body.data.experienceYears).toBe(8);
    });

    it('PUT /me: should reject unauthorized injection of privileged fields with 422', async () => {
      const res = await request(app)
        .put('/api/v1/workers/me')
        .set('Authorization', `Bearer ${worker1Token}`)
        .send({
          firstName: 'Ramesh',
          approvalStatus: 'APPROVED', // Client privilege escalation attempt
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Validation failed|Unrecognized key/i);
    });

    it('GET /me/status: should retrieve current onboarding progress status', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me/status')
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.submissionStatus).toBe('DRAFT');
      expect(res.body.data.approvalStatus).toBe('PENDING');
    });
  });

  // ============================================================================
  // Suite 3: Worker KYC Documents Management & IDOR Security
  // ============================================================================

  describe('3. Worker KYC Documents APIs & IDOR Prevention', () => {
    let uploadedDocId: string;

    it('POST /me/documents: should reject upload when file is missing with 400', async () => {
      const res = await request(app)
        .post('/api/v1/workers/me/documents')
        .set('Authorization', `Bearer ${worker1Token}`)
        .field('documentType', 'IDENTITY_PROOF');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Document file is required/i);
    });

    it('POST /me/documents: should reject invalid documentType with 422', async () => {
      const dummyFile = Buffer.from('%PDF-1.4 sample pdf document content');
      const res = await request(app)
        .post('/api/v1/workers/me/documents')
        .set('Authorization', `Bearer ${worker1Token}`)
        .field('documentType', 'INVALID_DOC_TYPE')
        .attach('file', dummyFile, 'doc.pdf');

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid document type|Validation failed/i);
    });

    it('POST /me/documents: should successfully upload a valid KYC document', async () => {
      const dummyFile = Buffer.from('%PDF-1.4 aadhaar card document binary content');
      const res = await request(app)
        .post('/api/v1/workers/me/documents')
        .set('Authorization', `Bearer ${worker1Token}`)
        .field('documentType', 'IDENTITY_PROOF')
        .field('documentNumber', 'AADHAAR-1234-5678')
        .attach('file', dummyFile, 'aadhaar.pdf');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.documentType).toBe('IDENTITY_PROOF');
      expect(res.body.data.verificationStatus).toBe('PENDING');
      uploadedDocId = res.body.data.id;
    });

    it('GET /me/documents: should list worker uploaded documents', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me/documents')
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const found = res.body.data.find((d: any) => d.id === uploadedDocId);
      expect(found).toBeDefined();
      expect(found.isLatest).toBe(true);
    });

    it('GET /me/documents/:id: should retrieve single document status details', async () => {
      const res = await request(app)
        .get(`/api/v1/workers/me/documents/${uploadedDocId}`)
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(uploadedDocId);
      expect(res.body.data.documentType).toBe('IDENTITY_PROOF');
    });

    it('GET /me/documents/:id/file: should securely stream document file for the owner', async () => {
      const res = await request(app)
        .get(`/api/v1/workers/me/documents/${uploadedDocId}/file`)
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/i);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toMatch(/inline; filename="worker-document-/i);
      expect(res.body).toBeDefined();
    });

    it('GET /me/documents/:id/file: should strictly reject Worker 2 accessing Worker 1 doc with 403 (IDOR block)', async () => {
      const res = await request(app)
        .get(`/api/v1/workers/me/documents/${uploadedDocId}/file`)
        .set('Authorization', `Bearer ${worker2Token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/permission to access this document/i);
    });

    it('PUT /me/documents/:id: should replace existing document with a new file version', async () => {
      const replacementFile = Buffer.from('%PDF-1.4 updated aadhaar scan binary');
      const res = await request(app)
        .put(`/api/v1/workers/me/documents/${uploadedDocId}`)
        .set('Authorization', `Bearer ${worker1Token}`)
        .attach('file', replacementFile, 'aadhaar_v2.pdf');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.documentType).toBe('IDENTITY_PROOF');
      expect(res.body.data.verificationStatus).toBe('PENDING');
    });
  });

  // ============================================================================
  // Suite 4: Worker Trade Skills Management
  // ============================================================================

  describe('4. Worker Trade Skills APIs', () => {
    let addedSkillId: string;

    it('POST /me/skills: should register a trade skill for the worker', async () => {
      const res = await request(app)
        .post('/api/v1/workers/me/skills')
        .set('Authorization', `Bearer ${worker1Token}`)
        .send({
          serviceCategoryId: categoryId.toString(),
          experienceYears: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.serviceCategoryId).toBe(categoryId.toString());
      expect(res.body.data.experienceYears).toBe(5);
      addedSkillId = res.body.data.id;
    });

    it('POST /me/skills: should reject duplicate skill registration with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/workers/me/skills')
        .set('Authorization', `Bearer ${worker1Token}`)
        .send({
          serviceCategoryId: categoryId.toString(),
          experienceYears: 6,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already registered/i);
    });

    it('GET /me/skills: should list all skills registered by the worker', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me/skills')
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].id).toBe(addedSkillId);
    });

    it('DELETE /me/skills/:id: should remove a registered trade skill', async () => {
      const res = await request(app)
        .delete(`/api/v1/workers/me/skills/${addedSkillId}`)
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify removal
      const checkRes = await request(app)
        .get('/api/v1/workers/me/skills')
        .set('Authorization', `Bearer ${worker1Token}`);
      const found = checkRes.body.data.find((s: any) => s.id === addedSkillId);
      expect(found).toBeUndefined();
    });
  });

  // ============================================================================
  // Suite 5: Worker Invitations Management
  // ============================================================================

  describe('5. Worker Invitations APIs', () => {
    let invitation1Id: string;
    let invitation1RawToken: string;
    let invitation2Id: string;
    let invitation2RawToken: string;

    beforeAll(async () => {
      // Create invitation 1 from Partner A to Worker 1
      const inv1 = await workerInvitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_1,
        workerName: 'Ramesh Kumar',
        proposedRole: 'Electrician',
        notes: 'Invitation for primary electrical partner network',
      });
      invitation1Id = inv1.invitation.id;
      invitation1RawToken = inv1.rawToken;

      // Create invitation 2 from Partner B to Worker 1 (multi-partner invitation)
      const inv2 = await workerInvitationService.createInvitation(partnerBUserId, {
        invitedMobile: MOB_WORKER_1,
        workerName: 'Ramesh Kumar',
        proposedRole: 'Backup Technician',
        notes: 'Second partner invitation to test rejection',
      });
      invitation2Id = inv2.invitation.id;
      invitation2RawToken = inv2.rawToken;
    });

    it('POST /invitations/lookup: should lookup invitation by raw token publicly without auth', async () => {
      const res = await request(app)
        .post('/api/v1/workers/invitations/lookup')
        .send({ token: invitation1RawToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(invitation1Id);
      expect(res.body.data.invitationStatus).toBe('PENDING');
      expect(res.body.data.partnerBusinessName).toBe('Apex Pro');
    });

    it('GET /invitations/public/:token: should inspect invitation details via path param publicly', async () => {
      const res = await request(app).get(`/api/v1/workers/invitations/public/${invitation1RawToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(invitation1Id);
      expect(res.body.data.invitationStatus).toBe('PENDING');
    });

    it('GET /me/invitations: should list received invitations for authenticated worker', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me/invitations')
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.meta).toBeDefined();
    });

    it('GET /me/invitations/:id: should retrieve details of specific received invitation', async () => {
      const res = await request(app)
        .get(`/api/v1/workers/me/invitations/${invitation1Id}`)
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(invitation1Id);
    });

    it('POST /me/invitations/:id/reject: should decline an invitation with reason', async () => {
      const res = await request(app)
        .post(`/api/v1/workers/me/invitations/${invitation2Id}/reject`)
        .set('Authorization', `Bearer ${worker1Token}`)
        .send({ reason: 'Not interested in secondary role at this moment.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invitationStatus).toBe('REJECTED');
    });

    it('POST /me/invitations/:id/accept: should accept invitation and create an affiliation', async () => {
      const res = await request(app)
        .post(`/api/v1/workers/me/invitations/${invitation1Id}/accept`)
        .set('Authorization', `Bearer ${worker1Token}`)
        .send({ notes: 'Excited to join the network!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invitation.invitationStatus).toBe('ACCEPTED');
      expect(res.body.data.affiliationId).toBeDefined();
    });
  });

  // ============================================================================
  // Suite 6: Worker Affiliations Management
  // ============================================================================

  describe('6. Worker Affiliations APIs', () => {
    let affiliationId: string;

    it('GET /me/affiliations: should list worker affiliations', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me/affiliations')
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      affiliationId = res.body.data[0].id;
      expect(res.body.data[0].affiliationStatus).toBe('ACTIVE');
    });

    it('GET /me/affiliations/:id: should get affiliation details', async () => {
      const res = await request(app)
        .get(`/api/v1/workers/me/affiliations/${affiliationId}`)
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(affiliationId);
      expect(res.body.data.partnerBusinessName).toBe('Apex Pro');
    });

    it('GET /me/affiliations/history: should retrieve affiliation audit history with pagination', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me/affiliations/history')
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
    });

    it('POST /me/affiliations/:id/terminate: should voluntarily terminate affiliation with reason', async () => {
      const res = await request(app)
        .post(`/api/v1/workers/me/affiliations/${affiliationId}/terminate`)
        .set('Authorization', `Bearer ${worker1Token}`)
        .send({ reason: 'Relocating to another city.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.affiliationStatus).toBe('TERMINATED');
      expect(res.body.data.terminationReason).toBe('Relocating to another city.');
    });
  });

  // ============================================================================
  // Suite 7: Worker Availability & Heartbeat APIs
  // ============================================================================

  describe('7. Worker Availability & Heartbeat APIs', () => {
    it('GET /me/availability: should return initial availability status (OFFLINE)', async () => {
      const res = await request(app)
        .get('/api/v1/workers/me/availability')
        .set('Authorization', `Bearer ${worker1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isOnline).toBe(false);
    });

    it('POST /me/duty-status: should reject going ONLINE if worker is not APPROVED with 403', async () => {
      const res = await request(app)
        .post('/api/v1/workers/me/duty-status')
        .set('Authorization', `Bearer ${worker1Token}`)
        .send({
          isOnline: true,
          latitude: 19.0760,
          longitude: 72.8777,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/approval|under review/i);
    });

    describe('Approved Worker Operations', () => {
      beforeAll(async () => {
        // Upgrade worker 1 to APPROVED status and mark documents VERIFIED to test operational endpoints
        await prisma.workerProfile.update({
          where: { userId: worker1UserId },
          data: {
            approvalStatus: 'APPROVED',
            submissionStatus: 'APPROVED',
            workerType: 'HELPER',
            reviewedAt: new Date(),
          },
        });

        await prisma.workerDocument.updateMany({
          where: { worker: { userId: worker1UserId } },
          data: {
            verificationStatus: 'VERIFIED',
          },
        });
      });

      it('POST /me/duty-status: should transition approved worker to ONLINE with coordinates', async () => {
        const res = await request(app)
          .post('/api/v1/workers/me/duty-status')
          .set('Authorization', `Bearer ${worker1Token}`)
          .send({
            isOnline: true,
            latitude: 19.0760,
            longitude: 72.8777,
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isOnline).toBe(true);
      });

      it('POST /me/heartbeat: should record operational keep-alive and update coordinates', async () => {
        const res = await request(app)
          .post('/api/v1/workers/me/heartbeat')
          .set('Authorization', `Bearer ${worker1Token}`)
          .send({
            latitude: 19.0765,
            longitude: 72.8780,
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isOnline).toBe(true);
        expect(res.body.data.lastHeartbeatAt).toBeDefined();
      });

      it('PATCH /me/duty-status: should transition worker to OFFLINE via PATCH', async () => {
        const res = await request(app)
          .patch('/api/v1/workers/me/duty-status')
          .set('Authorization', `Bearer ${worker1Token}`)
          .send({
            isOnline: false,
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isOnline).toBe(false);
      });
    });
  });
});
