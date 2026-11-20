import { prisma } from '../src/config/db.config';
import {
  WorkerAffiliationService,
  workerAffiliationService,
} from '../src/modules/workers/services/worker-affiliation.service';
import {
  WorkerInvitationService,
  workerInvitationService,
} from '../src/modules/workers/services/worker-invitation.service';
import {
  WorkerProfileRepository,
  WorkerPartnerAffiliationRepository,
} from '../src/modules/workers/repositories';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6E Batch 3: Worker Affiliations Service', () => {
  const affiliationService = workerAffiliationService;
  const invitationService = workerInvitationService;

  const profileRepo = new WorkerProfileRepository();
  const affiliationRepo = new WorkerPartnerAffiliationRepository();

  const MOB_PARTNER_1 = '+919922000001';
  const MOB_PARTNER_2 = '+919922000002';
  const MOB_PARTNER_3 = '+919922000003';
  const MOB_WORKER_AFFIL = '+919922000004';
  const MOB_UNAUTHORIZED_USER = '+919922000005';

  let partner1UserId: bigint;
  let partner2UserId: bigint;
  let partner3UserId: bigint;
  let partner1Id: bigint;
  let partner2Id: bigint;
  let partner3Id: bigint;

  let workerUserId: bigint;
  let workerProfileId: bigint;

  let unauthorizedUserId: bigint;

  beforeAll(async () => {
    const testMobiles = [
      MOB_PARTNER_1,
      MOB_PARTNER_2,
      MOB_PARTNER_3,
      MOB_WORKER_AFFIL,
      MOB_UNAUTHORIZED_USER,
    ];

    // Cleanup
    const existingUsers = await prisma.user.findMany({
      where: { mobileNumber: { in: testMobiles } },
      select: { id: true },
    });
    const userIds = existingUsers.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { actorUserId: { in: userIds } },
      });
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
          ],
        },
      });
      await prisma.workerDocument.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerSkill.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerAvailability.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerProfile.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.partnerProfile.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }

    const partnerRole =
      (await prisma.role.findUnique({ where: { roleName: 'PARTNER' } })) ||
      (await prisma.role.create({ data: { roleName: 'PARTNER', description: 'Partner' } }));
    const workerRole =
      (await prisma.role.findUnique({ where: { roleName: 'WORKER' } })) ||
      (await prisma.role.create({ data: { roleName: 'WORKER', description: 'Worker' } }));
    const customerRole =
      (await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } })) ||
      (await prisma.role.create({ data: { roleName: 'CUSTOMER', description: 'Customer' } }));

    // Partner 1
    const uP1 = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER_1, isMobileVerified: true },
    });
    partner1UserId = uP1.id;
    await prisma.userRole.create({ data: { userId: partner1UserId, roleId: partnerRole.id } });
    const p1 = await prisma.partnerProfile.create({
      data: {
        userId: partner1UserId,
        profileType: 'INDIVIDUAL',
        legalName: 'HomeFix Services',
        businessName: 'HomeFix Partner',
        approvalStatus: 'APPROVED',
      },
    });
    partner1Id = p1.id;

    // Partner 2
    const uP2 = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER_2, isMobileVerified: true },
    });
    partner2UserId = uP2.id;
    await prisma.userRole.create({ data: { userId: partner2UserId, roleId: partnerRole.id } });
    const p2 = await prisma.partnerProfile.create({
      data: {
        userId: partner2UserId,
        profileType: 'INDIVIDUAL',
        legalName: 'QuickPlumb Services',
        businessName: 'QuickPlumb Partner',
        approvalStatus: 'APPROVED',
      },
    });
    partner2Id = p2.id;

    // Partner 3
    const uP3 = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER_3, isMobileVerified: true },
    });
    partner3UserId = uP3.id;
    await prisma.userRole.create({ data: { userId: partner3UserId, roleId: partnerRole.id } });
    const p3 = await prisma.partnerProfile.create({
      data: {
        userId: partner3UserId,
        profileType: 'INDIVIDUAL',
        legalName: 'SparkElectric Services',
        businessName: 'SparkElectric Partner',
        approvalStatus: 'APPROVED',
      },
    });
    partner3Id = p3.id;

    // Worker with Profile
    const uWorker = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_AFFIL, isMobileVerified: true },
    });
    workerUserId = uWorker.id;
    await prisma.userRole.create({ data: { userId: workerUserId, roleId: customerRole.id } });
    const prof = await profileRepo.create({
      userId: workerUserId,
      firstName: 'Manish',
      lastName: 'Tiwari',
      workerType: 'TECHNICIAN',
      submissionStatus: 'DRAFT',
      approvalStatus: 'PENDING',
    });
    workerProfileId = prof.id;

    // Unauthorized User
    const uUnauth = await prisma.user.create({
      data: { mobileNumber: MOB_UNAUTHORIZED_USER, isMobileVerified: true },
    });
    unauthorizedUserId = uUnauth.id;
    await prisma.userRole.create({ data: { userId: unauthorizedUserId, roleId: customerRole.id } });
  });

  afterAll(async () => {
    const testMobiles = [
      MOB_PARTNER_1,
      MOB_PARTNER_2,
      MOB_PARTNER_3,
      MOB_WORKER_AFFIL,
      MOB_UNAUTHORIZED_USER,
    ];

    const existingUsers = await prisma.user.findMany({
      where: { mobileNumber: { in: testMobiles } },
      select: { id: true },
    });
    const userIds = existingUsers.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { actorUserId: { in: userIds } },
      });
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
          ],
        },
      });
      await prisma.workerDocument.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerSkill.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerAvailability.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerProfile.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.partnerProfile.deleteMany({
        where: { userId: { in: userIds } },
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
  // 1. Multi-Partner Non-Exclusive Affiliations
  // ==========================================================================
  describe('1. Non-Exclusive Multi-Partner Affiliations', () => {
    let affiliation1Id: string;
    let affiliation2Id: string;

    it('should establish active affiliation with Partner 1 via invitation acceptance', async () => {
      const inv1 = await invitationService.createInvitation(partner1UserId, {
        invitedMobile: MOB_WORKER_AFFIL,
      });

      const accept1 = await invitationService.acceptInvitation(inv1.invitation.id, workerUserId);
      expect(accept1.affiliationId).toBeDefined();

      affiliation1Id = accept1.affiliationId;
    });

    it('should establish SIMULTANEOUS active affiliation with Partner 2 (Non-exclusive multi-affiliation)', async () => {
      const inv2 = await invitationService.createInvitation(partner2UserId, {
        invitedMobile: MOB_WORKER_AFFIL,
      });

      const accept2 = await invitationService.acceptInvitation(inv2.invitation.id, workerUserId);
      expect(accept2.affiliationId).toBeDefined();

      affiliation2Id = accept2.affiliationId;

      // Verify worker has BOTH affiliations active at the same time
      const myAffiliations = await affiliationService.listMyAffiliations(workerUserId);
      expect(myAffiliations.length).toBeGreaterThanOrEqual(2);
      expect(myAffiliations.some((a) => a.id === affiliation1Id && a.affiliationStatus === 'ACTIVE')).toBe(true);
      expect(myAffiliations.some((a) => a.id === affiliation2Id && a.affiliationStatus === 'ACTIVE')).toBe(true);
    });

    it('should establish a THIRD simultaneous active affiliation with Partner 3 (No arbitrary cap)', async () => {
      const inv3 = await invitationService.createInvitation(partner3UserId, {
        invitedMobile: MOB_WORKER_AFFIL,
      });

      const accept3 = await invitationService.acceptInvitation(inv3.invitation.id, workerUserId);
      expect(accept3.affiliationId).toBeDefined();

      const myAffiliations = await affiliationService.listMyAffiliations(workerUserId);
      expect(myAffiliations.length).toBeGreaterThanOrEqual(3);
    });

    it('should PREVENT duplicate ACTIVE affiliation between same worker and same partner', async () => {
      // Direct repository attempt to create duplicate active affiliation
      await expect(
        affiliationRepo.create({
          workerId: workerProfileId,
          partnerId: partner1Id,
          affiliationStatus: 'ACTIVE',
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  // ==========================================================================
  // 2. Listing & Tenant Isolation
  // ==========================================================================
  describe('2. Listing & Tenant Isolation', () => {
    it('should allow partner to list only their own affiliated workers', async () => {
      const p1Workers = await affiliationService.listPartnerWorkers(partner1UserId);
      expect(p1Workers.items.length).toBeGreaterThanOrEqual(1);
      expect(p1Workers.items.every((a) => a.partnerId === partner1Id.toString())).toBe(true);
    });

    it('should allow worker to inspect their own affiliation details', async () => {
      const myAffils = await affiliationService.listMyAffiliations(workerUserId);
      const affilId = myAffils[0].id;

      const details = await affiliationService.getMyAffiliation(workerUserId, affilId);
      expect(details).toBeDefined();
      expect(details.workerId).toBe(workerProfileId.toString());
    });

    it('should FORBID partner from inspecting another partner affiliated worker (IDOR block)', async () => {
      const p1Workers = await affiliationService.listPartnerWorkers(partner1UserId);
      const p1AffiliationId = p1Workers.items[0].id;

      // Partner 2 attempts to inspect Partner 1's affiliation record
      await expect(
        affiliationService.getPartnerWorkerDetails(partner2UserId, p1AffiliationId)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ==========================================================================
  // 3. Voluntary Termination by Worker
  // ==========================================================================
  describe('3. Voluntary Termination by Worker', () => {
    it('should allow worker to voluntarily terminate their own affiliation', async () => {
      const myAffils = await affiliationService.listMyAffiliations(workerUserId);
      const targetAffil = myAffils.find((a) => a.partnerId === partner3Id.toString());
      expect(targetAffil).toBeDefined();

      const terminated = await affiliationService.terminateMyAffiliation(
        workerUserId,
        targetAffil!.id,
        'Decided to reduce weekly workload'
      );

      expect(terminated.affiliationStatus).toBe('TERMINATED');
      expect(terminated.terminationReason).toBe('Decided to reduce weekly workload');
      expect(terminated.terminatedAt).toBeDefined();

      // Verify historical preservation in DB
      const dbRecord = await prisma.workerPartnerAffiliation.findUnique({
        where: { id: BigInt(targetAffil!.id) },
      });
      expect(dbRecord?.affiliationStatus).toBe('TERMINATED');
      expect(dbRecord?.terminationReason).toBe('Decided to reduce weekly workload');

      // Verify atomic audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          actorUserId: workerUserId,
          action: 'WORKER_AFFILIATION_TERMINATED_BY_WORKER',
          entityId: BigInt(targetAffil!.id),
        },
      });
      expect(auditLog).toBeDefined();
    });

    it('should REJECT termination of an already TERMINATED affiliation', async () => {
      const history = await affiliationService.listMyAffiliations(workerUserId, {
        status: 'TERMINATED',
      });
      const terminatedAffil = history[0];

      await expect(
        affiliationService.terminateMyAffiliation(workerUserId, terminatedAffil.id)
      ).rejects.toThrow(ConflictError);
    });

    it('should FORBID worker from terminating an affiliation they do not own', async () => {
      const myAffils = await affiliationService.listMyAffiliations(workerUserId);
      const affilId = myAffils[0].id;

      // Unauthorized user attempts to terminate worker's affiliation
      await expect(
        affiliationService.terminateMyAffiliation(unauthorizedUserId, affilId)
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 4. Termination by Partner
  // ==========================================================================
  describe('4. Termination by Partner', () => {
    it('should allow partner to terminate their own affiliation with recorded reason', async () => {
      const p2Workers = await affiliationService.listPartnerWorkers(partner2UserId);
      const targetAffil = p2Workers.items[0];

      const terminated = await affiliationService.terminatePartnerAffiliation(
        partner2UserId,
        targetAffil.id,
        'Shift coverage no longer needed in this sector'
      );

      expect(terminated.affiliationStatus).toBe('TERMINATED');
      expect(terminated.terminationReason).toBe('Shift coverage no longer needed in this sector');
      expect(terminated.terminatedAt).toBeDefined();

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          actorUserId: partner2UserId,
          action: 'WORKER_AFFILIATION_TERMINATED_BY_PARTNER',
          entityId: BigInt(targetAffil.id),
        },
      });
      expect(auditLog).toBeDefined();
    });

    it('should FORBID Partner 1 from terminating Partner 2 affiliation', async () => {
      const myAffils = await affiliationService.listMyAffiliations(workerUserId);
      const p1Affil = myAffils.find((a) => a.partnerId === partner1Id.toString());
      expect(p1Affil).toBeDefined();

      // Partner 2 attempts to terminate Partner 1's affiliation
      await expect(
        affiliationService.terminatePartnerAffiliation(partner2UserId, p1Affil!.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ==========================================================================
  // 5. Affiliation History Inspection
  // ==========================================================================
  describe('5. Affiliation History Inspection', () => {
    it('should allow affiliated worker to view complete history', async () => {
      const myAffils = await affiliationService.listMyAffiliations(workerUserId);
      const affilId = myAffils[0].id;

      const history = await affiliationService.getAffiliationHistory(workerUserId, affilId);
      expect(history).toBeDefined();
      expect(history.id).toBe(affilId);
    });

    it('should allow affiliated partner to view complete history', async () => {
      const p1Workers = await affiliationService.listPartnerWorkers(partner1UserId);
      const affilId = p1Workers.items[0].id;

      const history = await affiliationService.getAffiliationHistory(partner1UserId, affilId);
      expect(history).toBeDefined();
      expect(history.id).toBe(affilId);
    });

    it('should FORBID third-party user from inspecting history', async () => {
      const p1Workers = await affiliationService.listPartnerWorkers(partner1UserId);
      const affilId = p1Workers.items[0].id;

      await expect(
        affiliationService.getAffiliationHistory(unauthorizedUserId, affilId)
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
