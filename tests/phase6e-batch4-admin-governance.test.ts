import { prisma } from '../src/config/db.config';
import {
  WorkerAdminGovernanceService,
  workerAdminGovernanceService,
} from '../src/modules/workers/services/worker-admin-governance.service';
import {
  WorkerAdminGovernanceRepository,
  WorkerProfileRepository,
  WorkerDocumentRepository,
  WorkerSkillRepository,
  WorkerAvailabilityRepository,
  WorkerPartnerAffiliationRepository,
} from '../src/modules/workers/repositories';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6E Batch 4: Worker Admin Governance & Identity Integration', () => {
  const governanceService = workerAdminGovernanceService;
  const governanceRepo = new WorkerAdminGovernanceRepository();
  const profileRepo = new WorkerProfileRepository();
  const documentRepo = new WorkerDocumentRepository();
  const skillRepo = new WorkerSkillRepository();
  const availabilityRepo = new WorkerAvailabilityRepository();
  const affiliationRepo = new WorkerPartnerAffiliationRepository();

  // Test mobile numbers for isolation
  const MOB_ADMIN = '+919933000001';
  const MOB_SUPER_ADMIN = '+919933000002';
  const MOB_NON_ADMIN = '+919933000003';
  const MOB_BLOCKED_ADMIN = '+919933000004';
  const MOB_ADMIN_WORKER = '+919933000005';

  const MOB_WORKER_SUBMITTED = '+919933000011';
  const MOB_WORKER_DRAFT = '+919933000012';
  const MOB_WORKER_BLOCKED = '+919933000013';
  const MOB_WORKER_REJECT_FLOW = '+919933000014';
  const MOB_WORKER_SUSPEND_FLOW = '+919933000015';

  const MOB_PARTNER = '+919933000021';

  // Seeded IDs
  let adminUserId: bigint;
  let superAdminUserId: bigint;
  let nonAdminUserId: bigint;
  let blockedAdminUserId: bigint;
  let adminWorkerUserId: bigint;
  let adminWorkerProfileId: bigint;

  let workerSubmittedUserId: bigint;
  let workerSubmittedProfileId: bigint;

  let workerDraftUserId: bigint;
  let workerDraftProfileId: bigint;

  let workerBlockedUserId: bigint;
  let workerBlockedProfileId: bigint;

  let workerRejectUserId: bigint;
  let workerRejectProfileId: bigint;

  let workerSuspendUserId: bigint;
  let workerSuspendProfileId: bigint;

  let partnerUserId: bigint;
  let partnerProfileId: bigint;

  let testCityId: bigint;
  let testServiceCategoryId: bigint;

  beforeAll(async () => {
    // 1. Comprehensive Cleanup of Test Records
    const allTestMobiles = [
      MOB_ADMIN,
      MOB_SUPER_ADMIN,
      MOB_NON_ADMIN,
      MOB_BLOCKED_ADMIN,
      MOB_ADMIN_WORKER,
      MOB_WORKER_SUBMITTED,
      MOB_WORKER_DRAFT,
      MOB_WORKER_BLOCKED,
      MOB_WORKER_REJECT_FLOW,
      MOB_WORKER_SUSPEND_FLOW,
      MOB_PARTNER,
    ];

    const existingUsers = await prisma.user.findMany({
      where: { mobileNumber: { in: allTestMobiles } },
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
            { invitedMobile: { in: allTestMobiles } },
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

    // 2. Roles Setup
    const adminRole =
      (await prisma.role.findUnique({ where: { roleName: 'ADMIN' } })) ||
      (await prisma.role.create({ data: { roleName: 'ADMIN', description: 'Administrator' } }));

    const superAdminRole =
      (await prisma.role.findUnique({ where: { roleName: 'SUPER_ADMIN' } })) ||
      (await prisma.role.create({ data: { roleName: 'SUPER_ADMIN', description: 'Super Administrator' } }));

    const customerRole =
      (await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } })) ||
      (await prisma.role.create({ data: { roleName: 'CUSTOMER', description: 'Customer' } }));

    const workerRole =
      (await prisma.role.findUnique({ where: { roleName: 'WORKER' } })) ||
      (await prisma.role.create({ data: { roleName: 'WORKER', description: 'Worker' } }));

    const partnerRole =
      (await prisma.role.findUnique({ where: { roleName: 'PARTNER' } })) ||
      (await prisma.role.create({ data: { roleName: 'PARTNER', description: 'Partner' } }));

    // 3. City and Category Setup
    const city =
      (await prisma.city.findFirst({ where: { cityName: 'Test Admin City' } })) ||
      (await prisma.city.create({
        data: {
          cityName: 'Test Admin City',
          citySlug: 'test-admin-city',
          stateName: 'Test State',
          isActive: true,
        },
      }));
    testCityId = city.id;

    const category =
      (await prisma.serviceCategory.findFirst({ where: { categoryCode: 'ADMIN_GOV_ELEC' } })) ||
      (await prisma.serviceCategory.create({
        data: {
          categoryCode: 'ADMIN_GOV_ELEC',
          categoryName: 'Electrical Maintenance',
          isActive: true,
        },
      }));
    testServiceCategoryId = category.id;

    // 4. Seed Users and Roles
    // A. Active Admin User
    const admin = await prisma.user.create({
      data: { mobileNumber: MOB_ADMIN, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    adminUserId = admin.id;
    await prisma.userRole.create({ data: { userId: adminUserId, roleId: adminRole.id } });

    // B. Active Super Admin User
    const superAdmin = await prisma.user.create({
      data: { mobileNumber: MOB_SUPER_ADMIN, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    superAdminUserId = superAdmin.id;
    await prisma.userRole.create({ data: { userId: superAdminUserId, roleId: superAdminRole.id } });

    // C. Non-Admin (Customer) User
    const nonAdmin = await prisma.user.create({
      data: { mobileNumber: MOB_NON_ADMIN, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    nonAdminUserId = nonAdmin.id;
    await prisma.userRole.create({ data: { userId: nonAdminUserId, roleId: customerRole.id } });

    // D. Blocked Admin User
    const blockedAdmin = await prisma.user.create({
      data: { mobileNumber: MOB_BLOCKED_ADMIN, isMobileVerified: true, accountStatus: 'BLOCKED' },
    });
    blockedAdminUserId = blockedAdmin.id;
    await prisma.userRole.create({ data: { userId: blockedAdminUserId, roleId: adminRole.id } });

    // E. Admin who also has a Worker Profile (Self-governance test)
    const adminWorker = await prisma.user.create({
      data: { mobileNumber: MOB_ADMIN_WORKER, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    adminWorkerUserId = adminWorker.id;
    await prisma.userRole.create({ data: { userId: adminWorkerUserId, roleId: adminRole.id } });
    await prisma.userRole.create({ data: { userId: adminWorkerUserId, roleId: workerRole.id } });
    const awProfile = await prisma.workerProfile.create({
      data: {
        userId: adminWorkerUserId,
        firstName: 'Self',
        lastName: 'AdminWorker',
        workerType: 'HELPER',
        submissionStatus: 'SUBMITTED',
        approvalStatus: 'PENDING',
        primaryCityId: testCityId,
        isActive: true,
      },
    });
    adminWorkerProfileId = awProfile.id;

    // F. Worker 1: Submitted application, pending approval
    const wSub = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_SUBMITTED, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    workerSubmittedUserId = wSub.id;
    await prisma.userRole.create({ data: { userId: workerSubmittedUserId, roleId: workerRole.id } });
    const wSubProfile = await prisma.workerProfile.create({
      data: {
        userId: workerSubmittedUserId,
        firstName: 'Amit',
        lastName: 'Kumar',
        workerType: 'HELPER',
        submissionStatus: 'SUBMITTED',
        approvalStatus: 'PENDING',
        primaryCityId: testCityId,
        isActive: true,
      },
    });
    workerSubmittedProfileId = wSubProfile.id;

    // G. Worker 2: Draft profile, not submitted
    const wDraft = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_DRAFT, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    workerDraftUserId = wDraft.id;
    await prisma.userRole.create({ data: { userId: workerDraftUserId, roleId: workerRole.id } });
    const wDraftProfile = await prisma.workerProfile.create({
      data: {
        userId: workerDraftUserId,
        firstName: 'Dheeraj',
        lastName: 'Sharma',
        workerType: 'HELPER',
        submissionStatus: 'DRAFT',
        approvalStatus: 'PENDING',
        primaryCityId: testCityId,
        isActive: true,
      },
    });
    workerDraftProfileId = wDraftProfile.id;

    // H. Worker 3: Blocked User Account
    const wBlocked = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_BLOCKED, isMobileVerified: true, accountStatus: 'BLOCKED' },
    });
    workerBlockedUserId = wBlocked.id;
    await prisma.userRole.create({ data: { userId: workerBlockedUserId, roleId: workerRole.id } });
    const wBlockedProfile = await prisma.workerProfile.create({
      data: {
        userId: workerBlockedUserId,
        firstName: 'Blocked',
        lastName: 'UserWorker',
        workerType: 'HELPER',
        submissionStatus: 'SUBMITTED',
        approvalStatus: 'SUSPENDED',
        suspendedAt: new Date(),
        suspensionReason: 'Account suspended for review',
        primaryCityId: testCityId,
        isActive: true,
      },
    });
    workerBlockedProfileId = wBlockedProfile.id;

    // I. Worker 4: Profile for Rejection flow
    const wReject = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_REJECT_FLOW, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    workerRejectUserId = wReject.id;
    await prisma.userRole.create({ data: { userId: workerRejectUserId, roleId: workerRole.id } });
    const wRejectProfile = await prisma.workerProfile.create({
      data: {
        userId: workerRejectUserId,
        firstName: 'Pankaj',
        lastName: 'Verma',
        workerType: 'HELPER',
        submissionStatus: 'SUBMITTED',
        approvalStatus: 'PENDING',
        primaryCityId: testCityId,
        isActive: true,
      },
    });
    workerRejectProfileId = wRejectProfile.id;

    // J. Worker 5: Approved worker for Suspension & Reactivation flow
    const wSuspend = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_SUSPEND_FLOW, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    workerSuspendUserId = wSuspend.id;
    await prisma.userRole.create({ data: { userId: workerSuspendUserId, roleId: workerRole.id } });
    const wSuspendProfile = await prisma.workerProfile.create({
      data: {
        userId: workerSuspendUserId,
        firstName: 'Sunil',
        lastName: 'Yadav',
        workerType: 'TECHNICIAN',
        submissionStatus: 'APPROVED',
        approvalStatus: 'APPROVED',
        primaryCityId: testCityId,
        isActive: true,
      },
    });
    workerSuspendProfileId = wSuspendProfile.id;

    // Availability for worker 5 (starts online to test suspension offline force)
    await prisma.workerAvailability.create({
      data: {
        workerId: workerSuspendProfileId,
        isOnline: true,
        isBusy: false,
        lastHeartbeatAt: new Date(),
      },
    });

    // K. Partner User and Affiliation with Worker 5 (to test affiliation preservation during suspension)
    const partner = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    partnerUserId = partner.id;
    await prisma.userRole.create({ data: { userId: partnerUserId, roleId: partnerRole.id } });
    const pProfile = await prisma.partnerProfile.create({
      data: {
        userId: partnerUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Partner Admin Test Co',
        approvalStatus: 'APPROVED',
      },
    });
    partnerProfileId = pProfile.id;

    await prisma.workerPartnerAffiliation.create({
      data: {
        workerId: workerSuspendProfileId,
        partnerId: partnerProfileId,
        affiliationStatus: 'ACTIVE',
        consentGivenAt: new Date(),
        affiliatedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    // Cleanup created test records
    const allTestMobiles = [
      MOB_ADMIN,
      MOB_SUPER_ADMIN,
      MOB_NON_ADMIN,
      MOB_BLOCKED_ADMIN,
      MOB_ADMIN_WORKER,
      MOB_WORKER_SUBMITTED,
      MOB_WORKER_DRAFT,
      MOB_WORKER_BLOCKED,
      MOB_WORKER_REJECT_FLOW,
      MOB_WORKER_SUSPEND_FLOW,
      MOB_PARTNER,
    ];

    const users = await prisma.user.findMany({
      where: { mobileNumber: { in: allTestMobiles } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

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
            { invitedMobile: { in: allTestMobiles } },
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

  // ==========================================================================
  // 1. Authorization and Role-Based Access Control
  // ==========================================================================
  describe('1. Administrative Authorization & Role-Based Access Control', () => {
    it('should throw ForbiddenError when non-admin lists worker applications', async () => {
      await expect(
        governanceService.listWorkerApplications(nonAdminUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when non-admin gets worker application details', async () => {
      await expect(
        governanceService.getWorkerApplicationDetails(nonAdminUserId, workerSubmittedProfileId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when non-admin attempts to approve a worker', async () => {
      await expect(
        governanceService.approveWorker(nonAdminUserId, workerSubmittedProfileId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when non-admin attempts to reject a worker', async () => {
      await expect(
        governanceService.rejectWorker(nonAdminUserId, workerSubmittedProfileId, 'Invalid documents')
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when non-admin attempts to suspend a worker', async () => {
      await expect(
        governanceService.suspendWorker(nonAdminUserId, workerSuspendProfileId, 'Policy violation')
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when non-admin attempts to reactivate a worker', async () => {
      await expect(
        governanceService.reactivateWorker(nonAdminUserId, workerSuspendProfileId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when blocked admin attempts any governance action', async () => {
      await expect(
        governanceService.listWorkerApplications(blockedAdminUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow SUPER_ADMIN to list worker applications successfully', async () => {
      const result = await governanceService.listWorkerApplications(
        superAdminUserId,
        undefined,
        { limit: 10 }
      );
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.page).toBe(1);
    });

    it('should throw ForbiddenError when admin attempts self-governance approval on their own worker profile', async () => {
      await expect(
        governanceService.approveWorker(adminWorkerUserId, adminWorkerProfileId)
      ).rejects.toThrow('Administrators cannot approve their own worker profile.');
    });

    it('should throw ForbiddenError when admin attempts self-governance rejection on their own worker profile', async () => {
      await expect(
        governanceService.rejectWorker(adminWorkerUserId, adminWorkerProfileId, 'Self rejection')
      ).rejects.toThrow('Administrators cannot reject their own worker profile.');
    });

    it('should throw ForbiddenError when admin attempts self-governance suspension on their own worker profile', async () => {
      await expect(
        governanceService.suspendWorker(adminWorkerUserId, adminWorkerProfileId, 'Self suspension')
      ).rejects.toThrow('Administrators cannot suspend their own worker profile.');
    });

    it('should throw ForbiddenError when admin attempts self-governance reactivation on their own worker profile', async () => {
      await expect(
        governanceService.reactivateWorker(adminWorkerUserId, adminWorkerProfileId)
      ).rejects.toThrow('Administrators cannot reactivate their own worker profile.');
    });
  });

  // ==========================================================================
  // 2. Worker Application Review & Safe Serialization
  // ==========================================================================
  describe('2. Application Review, Dossier Inspection & Safe Serialization', () => {
    it('should list worker applications with pagination and filters', async () => {
      const res = await governanceService.listWorkerApplications(
        adminUserId,
        {
          approvalStatus: 'PENDING',
          workerType: 'HELPER',
        },
        {
          limit: 5,
          page: 1,
        }
      );

      expect(res).toBeDefined();
      expect(res.page).toBe(1);
      expect(res.limit).toBe(5);
      expect(res.items.length).toBeGreaterThanOrEqual(1);

      const found = res.items.find((item) => item.id === workerSubmittedProfileId.toString());
      expect(found).toBeDefined();
      expect(found?.approvalStatus).toBe('PENDING');
      expect(found?.workerType).toBe('HELPER');
      expect(found?.mobileNumber).toBe(MOB_WORKER_SUBMITTED);
    });

    it('should filter worker applications by search text matching mobile number', async () => {
      const res = await governanceService.listWorkerApplications(adminUserId, {
        search: MOB_WORKER_SUBMITTED,
      });

      expect(res.items.length).toBe(1);
      expect(res.items[0].id).toBe(workerSubmittedProfileId.toString());
    });

    it('should filter worker applications by search text matching name', async () => {
      const res = await governanceService.listWorkerApplications(adminUserId, {
        search: 'Dheeraj',
      });

      expect(res.items.length).toBe(1);
      expect(res.items[0].id).toBe(workerDraftProfileId.toString());
    });

    it('should throw NotFoundError when fetching details of a non-existent worker', async () => {
      await expect(
        governanceService.getWorkerApplicationDetails(adminUserId, 99999999999n)
      ).rejects.toThrow(NotFoundError);
    });

    it('should return complete application dossier with evaluated KYC and zero storage paths', async () => {
      // Seed a document for workerSubmitted
      const doc = await prisma.workerDocument.create({
        data: {
          workerId: workerSubmittedProfileId,
          documentType: 'IDENTITY_PROOF',
          documentStorageKey: 'private/workers/docs/test-aadhar.pdf',
          originalName: 'aadhar_card.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 10240n,
          verificationStatus: 'PENDING',
          expiryDate: new Date('2030-12-31'),
        },
      });

      const dossier = await governanceService.getWorkerApplicationDetails(
        adminUserId,
        workerSubmittedProfileId
      );

      expect(dossier).toBeDefined();
      expect(dossier.id).toBe(workerSubmittedProfileId.toString());
      expect(dossier.workerType).toBe('HELPER');
      expect(dossier.firstName).toBe('Amit');
      expect(dossier.lastName).toBe('Kumar');

      // Check KYC evaluation
      expect(dossier.kycEvaluation).toBeDefined();
      expect(dossier.kycEvaluation.isValid).toBe(false); // doc is PENDING, so not verified yet
      expect(dossier.kycEvaluation.unverifiedDocuments).toContain('IDENTITY_PROOF');

      // CRITICAL SECURITY CHECK: Verify NO storagePath or storageKey is leaked
      expect(dossier.documents.length).toBe(1);
      const docSummary = dossier.documents[0];
      expect(docSummary.id).toBe(doc.id.toString());
      expect(docSummary.documentType).toBe('IDENTITY_PROOF');
      expect(docSummary.verificationStatus).toBe('PENDING');

      const serializedJson = JSON.stringify(dossier);
      expect(serializedJson).not.toContain('/var/storage');
      expect(serializedJson).not.toContain('test-aadhar.pdf');
      expect((docSummary as any).documentStorageKey).toBeUndefined();
      expect((docSummary as any).storagePath).toBeUndefined();
      expect((docSummary as any).storageKey).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. Document & Skill Administrative Verification and Rejection
  // ==========================================================================
  describe('3. Document & Skill Verification / Rejection Operations', () => {
    let testDocId: bigint;
    let testSkillId: bigint;

    beforeAll(async () => {
      // Create a test document for workerReject
      const doc = await prisma.workerDocument.create({
        data: {
          workerId: workerRejectProfileId,
          documentType: 'POLICE_VERIFICATION',
          documentStorageKey: 'private/workers/docs/pv.pdf',
          originalName: 'police_cert.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 5000n,
          verificationStatus: 'PENDING',
        },
      });
      testDocId = doc.id;

      // Create a test skill for workerReject
      const skill = await prisma.workerSkill.create({
        data: {
          workerId: workerRejectProfileId,
          serviceCategoryId: testServiceCategoryId,
          experienceYears: 4,
          verificationStatus: 'PENDING',
        },
      });
      testSkillId = skill.id;
    });

    it('should throw NotFoundError when verifying a non-existent document', async () => {
      await expect(
        governanceService.verifyWorkerDocument(adminUserId, 99999999999n)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BadRequestError when rejecting a document without a reason', async () => {
      await expect(
        governanceService.rejectWorkerDocument(adminUserId, testDocId, '   ')
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject a worker document with valid reason and record audit log', async () => {
      const result = await governanceService.rejectWorkerDocument(
        adminUserId,
        testDocId,
        'Police clearance seal is illegible',
        { ip: '127.0.0.1', userAgent: 'Jest-Batch4' }
      );

      expect(result.id).toBe(testDocId.toString());
      expect(result.verificationStatus).toBe('REJECTED');
      expect(result.rejectionReason).toBe('Police clearance seal is illegible');

      const inDb = await documentRepo.findById(testDocId);
      expect(inDb?.verificationStatus).toBe('REJECTED');
      expect(inDb?.rejectionReason).toBe('Police clearance seal is illegible');
      expect(inDb?.reviewedBy).toBe(adminUserId);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'WORKER_DOCUMENT_REJECTED',
          entityName: 'WorkerDocument',
          entityId: testDocId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
    });

    it('should verify a worker document and record audit log', async () => {
      const result = await governanceService.verifyWorkerDocument(
        adminUserId,
        testDocId,
        { ip: '127.0.0.1', userAgent: 'Jest-Batch4' }
      );

      expect(result.id).toBe(testDocId.toString());
      expect(result.verificationStatus).toBe('VERIFIED');
      expect(result.rejectionReason).toBeNull();

      const inDb = await documentRepo.findById(testDocId);
      expect(inDb?.verificationStatus).toBe('VERIFIED');
      expect(inDb?.reviewedBy).toBe(adminUserId);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'WORKER_DOCUMENT_VERIFIED',
          entityName: 'WorkerDocument',
          entityId: testDocId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
    });

    it('should throw BadRequestError when rejecting a skill without reason', async () => {
      await expect(
        governanceService.rejectWorkerSkill(adminUserId, testSkillId, '')
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject a worker skill with valid reason and record audit log', async () => {
      const result = await governanceService.rejectWorkerSkill(
        adminUserId,
        testSkillId,
        'Experience could not be independently substantiated',
        { ip: '127.0.0.1', userAgent: 'Jest-Batch4' }
      );

      expect(result.id).toBe(testSkillId.toString());
      expect(result.verificationStatus).toBe('REJECTED');
      expect(result.rejectionReason).toBe('Experience could not be independently substantiated');

      const inDb = await skillRepo.findById(testSkillId);
      expect(inDb?.verificationStatus).toBe('REJECTED');
      expect(inDb?.rejectionReason).toBe('Experience could not be independently substantiated');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'WORKER_SKILL_REJECTED',
          entityName: 'WorkerSkill',
          entityId: testSkillId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
    });

    it('should verify a worker skill and record audit log', async () => {
      const result = await governanceService.verifyWorkerSkill(
        adminUserId,
        testSkillId,
        { ip: '127.0.0.1', userAgent: 'Jest-Batch4' }
      );

      expect(result.id).toBe(testSkillId.toString());
      expect(result.verificationStatus).toBe('VERIFIED');
      expect(result.rejectionReason).toBeNull();

      const inDb = await skillRepo.findById(testSkillId);
      expect(inDb?.verificationStatus).toBe('VERIFIED');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'WORKER_SKILL_VERIFIED',
          entityName: 'WorkerSkill',
          entityId: testSkillId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
    });
  });

  // ==========================================================================
  // 4. Worker Approval Lifecycle & KYC Gate Enforcement
  // ==========================================================================
  describe('4. Worker Approval Lifecycle & KYC Gate Enforcement', () => {
    it('should reject approval if worker profile is in DRAFT status', async () => {
      await expect(
        governanceService.approveWorker(adminUserId, workerDraftProfileId)
      ).rejects.toThrow("Cannot approve worker profile in 'DRAFT' status");
    });

    it('should reject approval if worker does not satisfy mandatory KYC requirements', async () => {
      // workerSubmitted currently has an unverified (PENDING) IDENTITY_PROOF document
      await expect(
        governanceService.approveWorker(adminUserId, workerSubmittedProfileId)
      ).rejects.toThrow('Worker approval blocked by KYC policy');
    });

    it('should successfully approve worker when KYC requirements are verified', async () => {
      // Find the document of workerSubmitted and mark it VERIFIED
      const latestDoc = await documentRepo.findLatestByType(
        workerSubmittedProfileId,
        'IDENTITY_PROOF'
      );
      expect(latestDoc).toBeDefined();

      await governanceService.verifyWorkerDocument(adminUserId, latestDoc!.id);

      // Now approve workerSubmitted
      const approved = await governanceService.approveWorker(
        adminUserId,
        workerSubmittedProfileId,
        { ip: '127.0.0.1', userAgent: 'Jest-Batch4' }
      );

      expect(approved.id).toBe(workerSubmittedProfileId.toString());
      expect(approved.approvalStatus).toBe('APPROVED');
      expect(approved.submissionStatus).toBe('APPROVED');
      expect(approved.reviewedBy).toBe(adminUserId.toString());
      expect(approved.reviewedAt).not.toBeNull();

      // Verify database state
      const dbProfile = await profileRepo.findById(workerSubmittedProfileId);
      expect(dbProfile?.approvalStatus).toBe('APPROVED');
      expect(dbProfile?.submissionStatus).toBe('APPROVED');
      expect(dbProfile?.reviewedBy).toBe(adminUserId);

      // Verify availability record was initialized in offline state
      const avail = await availabilityRepo.findByWorkerId(workerSubmittedProfileId);
      expect(avail).toBeDefined();
      expect(avail?.isOnline).toBe(false);

      // Verify audit log record
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'WORKER_ADMIN_APPROVED',
          entityName: 'WorkerProfile',
          entityId: workerSubmittedProfileId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
      expect((audit?.newValues as any)?.approvalStatus).toBe('APPROVED');
    });

    it('should reject duplicate approval attempt on an already approved worker', async () => {
      await expect(
        governanceService.approveWorker(adminUserId, workerSubmittedProfileId)
      ).rejects.toThrow('Worker profile is already approved.');
    });
  });

  // ==========================================================================
  // 5. Worker Rejection Lifecycle
  // ==========================================================================
  describe('5. Worker Rejection Lifecycle', () => {
    it('should throw BadRequestError when rejecting a worker without reason', async () => {
      await expect(
        governanceService.rejectWorker(adminUserId, workerRejectProfileId, '   ')
      ).rejects.toThrow(BadRequestError);
    });

    it('should successfully reject a worker application and record audit log', async () => {
      const rejected = await governanceService.rejectWorker(
        adminUserId,
        workerRejectProfileId,
        'Failed baseline background check',
        { ip: '127.0.0.1', userAgent: 'Jest-Batch4' }
      );

      expect(rejected.id).toBe(workerRejectProfileId.toString());
      expect(rejected.approvalStatus).toBe('REJECTED');
      expect(rejected.submissionStatus).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Failed baseline background check');
      expect(rejected.reviewedBy).toBe(adminUserId.toString());
      expect(rejected.reviewedAt).not.toBeNull();

      // Check DB profile
      const dbProfile = await profileRepo.findById(workerRejectProfileId);
      expect(dbProfile?.approvalStatus).toBe('REJECTED');
      expect(dbProfile?.submissionStatus).toBe('REJECTED');
      expect(dbProfile?.rejectionReason).toBe('Failed baseline background check');

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'WORKER_ADMIN_REJECTED',
          entityName: 'WorkerProfile',
          entityId: workerRejectProfileId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
      expect((audit?.newValues as any)?.rejectionReason).toBe('Failed baseline background check');
    });
  });

  // ==========================================================================
  // 6. Worker Suspension Lifecycle & Multi-Partner Affiliation Preservation
  // ==========================================================================
  describe('6. Worker Suspension Lifecycle & Multi-Partner Integrity', () => {
    it('should throw BadRequestError when suspending without reason', async () => {
      await expect(
        governanceService.suspendWorker(adminUserId, workerSuspendProfileId, '')
      ).rejects.toThrow(BadRequestError);
    });

    it('should suspend approved worker, force availability offline, and preserve affiliations', async () => {
      // Prior check: worker 5 was online
      const availBefore = await availabilityRepo.findByWorkerId(workerSuspendProfileId);
      expect(availBefore?.isOnline).toBe(true);

      const suspended = await governanceService.suspendWorker(
        adminUserId,
        workerSuspendProfileId,
        'Pending safety investigation following customer report',
        { ip: '127.0.0.1', userAgent: 'Jest-Batch4' }
      );

      expect(suspended.id).toBe(workerSuspendProfileId.toString());
      expect(suspended.approvalStatus).toBe('SUSPENDED');
      expect(suspended.suspensionReason).toBe(
        'Pending safety investigation following customer report'
      );
      expect(suspended.suspendedAt).not.toBeNull();

      // 1. Verify availability is immediately forced offline
      const availAfter = await availabilityRepo.findByWorkerId(workerSuspendProfileId);
      expect(availAfter?.isOnline).toBe(false);

      // 2. Verify affiliations are preserved intact
      const affiliations = await affiliationRepo.listActiveByWorker(workerSuspendProfileId);
      expect(affiliations.length).toBe(1);
      expect(affiliations[0].affiliationStatus).toBe('ACTIVE');
      expect(affiliations[0].partnerId).toBe(partnerProfileId);

      // 3. Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'WORKER_ADMIN_SUSPENDED',
          entityName: 'WorkerProfile',
          entityId: workerSuspendProfileId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
      expect((audit?.newValues as any)?.suspensionReason).toBe(
        'Pending safety investigation following customer report'
      );
    });

    it('should throw ConflictError when attempting to suspend an already suspended worker', async () => {
      await expect(
        governanceService.suspendWorker(
          adminUserId,
          workerSuspendProfileId,
          'Duplicate suspension attempt'
        )
      ).rejects.toThrow(ConflictError);
    });
  });

  // ==========================================================================
  // 7. Worker Reactivation Lifecycle & Identity Consistency
  // ==========================================================================
  describe('7. Worker Reactivation Lifecycle & Identity Consistency', () => {
    it('should throw BadRequestError when attempting to reactivate a non-suspended worker', async () => {
      await expect(
        governanceService.reactivateWorker(adminUserId, workerSubmittedProfileId)
      ).rejects.toThrow('Only SUSPENDED worker profiles can be reactivated');
    });

    it('should throw ForbiddenError when reactivating a worker whose User account is BLOCKED', async () => {
      await expect(
        governanceService.reactivateWorker(adminUserId, workerBlockedProfileId)
      ).rejects.toThrow("Cannot reactivate worker: Associated user account status is 'BLOCKED'");
    });

    it('should reactivate suspended worker, keep offline by default, and log audit', async () => {
      const reactivated = await governanceService.reactivateWorker(
        adminUserId,
        workerSuspendProfileId,
        { ip: '127.0.0.1', userAgent: 'Jest-Batch4' }
      );

      expect(reactivated.id).toBe(workerSuspendProfileId.toString());
      expect(reactivated.approvalStatus).toBe('APPROVED');
      expect(reactivated.suspendedAt).toBeNull();

      // Check DB
      const dbProfile = await profileRepo.findById(workerSuspendProfileId);
      expect(dbProfile?.approvalStatus).toBe('APPROVED');
      expect(dbProfile?.suspendedAt).toBeNull();

      // Worker must remain offline until explicit goOnline heartbeat
      const avail = await availabilityRepo.findByWorkerId(workerSuspendProfileId);
      expect(avail?.isOnline).toBe(false);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'WORKER_ADMIN_REACTIVATED',
          entityName: 'WorkerProfile',
          entityId: workerSuspendProfileId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId).toBe(adminUserId);
      expect((audit?.newValues as any)?.approvalStatus).toBe('APPROVED');
    });
  });

  // ==========================================================================
  // 8. Immutable Audit Trail & Database Consistency
  // ==========================================================================
  describe('8. Immutable Audit Trail & Database Consistency', () => {
    it('should record immutable audit logs with complete metadata across all governance events', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          actorUserId: adminUserId,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(logs.length).toBeGreaterThanOrEqual(5);

      const actionTypes = logs.map((l) => l.action);
      expect(actionTypes).toContain('WORKER_ADMIN_APPROVED');
      expect(actionTypes).toContain('WORKER_ADMIN_REJECTED');
      expect(actionTypes).toContain('WORKER_ADMIN_SUSPENDED');
      expect(actionTypes).toContain('WORKER_ADMIN_REACTIVATED');
      expect(actionTypes).toContain('WORKER_DOCUMENT_VERIFIED');
      expect(actionTypes).toContain('WORKER_SKILL_VERIFIED');

      for (const log of logs) {
        expect(log.actorUserId).toBe(adminUserId);
        expect(log.entityName).toMatch(/Worker(Profile|Document|Skill)/);
        expect(log.newValues).toBeDefined();
      }
    });
  });
});
