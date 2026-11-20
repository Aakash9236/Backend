import { prisma } from '../src/config/db.config';
import {
  WorkerAvailabilityService,
  workerAvailabilityService,
  WORKER_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_DISPATCH_LOCK_TTL_SECONDS,
} from '../src/modules/workers/services/worker-availability.service';
import {
  WorkerProfileRepository,
  WorkerDocumentRepository,
  WorkerAvailabilityRepository,
} from '../src/modules/workers/repositories';
import {
  DefaultWorkerKycPolicyProvider,
  WorkerKycValidationService,
} from '../src/modules/workers/services/worker-kyc.service';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6E Batch 3: Worker Availability & Dispatch Lock Service', () => {
  let availabilityService: WorkerAvailabilityService;
  let policyProvider: DefaultWorkerKycPolicyProvider;
  let kycValidator: WorkerKycValidationService;

  const profileRepo = new WorkerProfileRepository();
  const documentRepo = new WorkerDocumentRepository();
  const availabilityRepo = new WorkerAvailabilityRepository();

  const MOB_WORKER_APPROVED = '+919933000001';
  const MOB_WORKER_PENDING = '+919933000002';
  const MOB_WORKER_SUSPENDED = '+919933000003';
  const MOB_WORKER_EXPIRED_KYC = '+919933000004';
  const MOB_WORKER_INDEPENDENT = '+919933000005';

  let workerApprovedUserId: bigint;
  let workerApprovedProfileId: bigint;

  let workerPendingUserId: bigint;
  let workerPendingProfileId: bigint;

  let workerSuspendedUserId: bigint;
  let workerSuspendedProfileId: bigint;

  let workerExpiredKycUserId: bigint;
  let workerExpiredKycProfileId: bigint;

  let workerIndependentUserId: bigint;
  let workerIndependentProfileId: bigint;

  beforeAll(async () => {
    policyProvider = new DefaultWorkerKycPolicyProvider();
    kycValidator = new WorkerKycValidationService(policyProvider);
    availabilityService = new WorkerAvailabilityService(availabilityRepo, profileRepo, kycValidator);

    const testMobiles = [
      MOB_WORKER_APPROVED,
      MOB_WORKER_PENDING,
      MOB_WORKER_SUSPENDED,
      MOB_WORKER_EXPIRED_KYC,
      MOB_WORKER_INDEPENDENT,
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
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerInvitation.deleteMany({
        where: { invitedMobile: { in: testMobiles } },
      });
      await prisma.workerAvailability.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerDocument.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerSkill.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerProfile.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }

    const workerRole =
      (await prisma.role.findUnique({ where: { roleName: 'WORKER' } })) ||
      (await prisma.role.create({ data: { roleName: 'WORKER', description: 'Worker' } }));

    // 1. Worker Approved with Valid KYC Documents (HELPER: needs IDENTITY_PROOF + PROFILE_PHOTO)
    const uApp = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_APPROVED, isMobileVerified: true },
    });
    workerApprovedUserId = uApp.id;
    await prisma.userRole.create({ data: { userId: workerApprovedUserId, roleId: workerRole.id } });
    const pApp = await profileRepo.create({
      userId: workerApprovedUserId,
      firstName: 'Approved',
      lastName: 'Worker',
      workerType: 'HELPER',
      submissionStatus: 'APPROVED',
      approvalStatus: 'APPROVED',
    });
    workerApprovedProfileId = pApp.id;

    // Upload verified unexpired documents
    await documentRepo.create({
      workerId: workerApprovedProfileId,
      documentType: 'IDENTITY_PROOF',
      documentStorageKey: 'workers/id_app.pdf',
      verificationStatus: 'VERIFIED',
      expiryDate: new Date('2035-01-01'),
    });
    await documentRepo.create({
      workerId: workerApprovedProfileId,
      documentType: 'PROFILE_PHOTO',
      documentStorageKey: 'workers/photo_app.jpg',
      verificationStatus: 'VERIFIED',
    });

    // 2. Worker Pending Approval
    const uPend = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_PENDING, isMobileVerified: true },
    });
    workerPendingUserId = uPend.id;
    await prisma.userRole.create({ data: { userId: workerPendingUserId, roleId: workerRole.id } });
    const pPend = await profileRepo.create({
      userId: workerPendingUserId,
      firstName: 'Pending',
      lastName: 'Worker',
      workerType: 'HELPER',
      submissionStatus: 'SUBMITTED',
      approvalStatus: 'PENDING',
    });
    workerPendingProfileId = pPend.id;

    // 3. Worker Suspended
    const uSusp = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_SUSPENDED, isMobileVerified: true },
    });
    workerSuspendedUserId = uSusp.id;
    await prisma.userRole.create({ data: { userId: workerSuspendedUserId, roleId: workerRole.id } });
    const pSusp = await profileRepo.create({
      userId: workerSuspendedUserId,
      firstName: 'Suspended',
      lastName: 'Worker',
      workerType: 'HELPER',
      submissionStatus: 'APPROVED',
      approvalStatus: 'SUSPENDED',
    });
    await profileRepo.updateSuspensionStatus(pSusp.id, 'SUSPENDED', 'Policy breach', new Date());
    workerSuspendedProfileId = pSusp.id;

    // 4. Worker with Expired KYC Document
    const uExp = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_EXPIRED_KYC, isMobileVerified: true },
    });
    workerExpiredKycUserId = uExp.id;
    await prisma.userRole.create({ data: { userId: workerExpiredKycUserId, roleId: workerRole.id } });
    const pExp = await profileRepo.create({
      userId: workerExpiredKycUserId,
      firstName: 'ExpiredKYC',
      lastName: 'Worker',
      workerType: 'HELPER',
      submissionStatus: 'APPROVED',
      approvalStatus: 'APPROVED',
    });
    workerExpiredKycProfileId = pExp.id;

    await documentRepo.create({
      workerId: workerExpiredKycProfileId,
      documentType: 'IDENTITY_PROOF',
      documentStorageKey: 'workers/id_exp.pdf',
      verificationStatus: 'VERIFIED',
      expiryDate: new Date('2020-01-01'), // Expired
    });
    await documentRepo.create({
      workerId: workerExpiredKycProfileId,
      documentType: 'PROFILE_PHOTO',
      documentStorageKey: 'workers/photo_exp.jpg',
      verificationStatus: 'VERIFIED',
    });

    // 5. Worker Independent (Approved + Compliant KYC, No Partner Affiliation)
    const uInd = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_INDEPENDENT, isMobileVerified: true },
    });
    workerIndependentUserId = uInd.id;
    await prisma.userRole.create({ data: { userId: workerIndependentUserId, roleId: workerRole.id } });
    const pInd = await profileRepo.create({
      userId: workerIndependentUserId,
      firstName: 'Independent',
      lastName: 'Worker',
      workerType: 'HELPER',
      submissionStatus: 'APPROVED',
      approvalStatus: 'APPROVED',
    });
    workerIndependentProfileId = pInd.id;

    await documentRepo.create({
      workerId: workerIndependentProfileId,
      documentType: 'IDENTITY_PROOF',
      documentStorageKey: 'workers/id_ind.pdf',
      verificationStatus: 'VERIFIED',
      expiryDate: new Date('2035-01-01'),
    });
    await documentRepo.create({
      workerId: workerIndependentProfileId,
      documentType: 'PROFILE_PHOTO',
      documentStorageKey: 'workers/photo_ind.jpg',
      verificationStatus: 'VERIFIED',
    });
  });

  afterAll(async () => {
    const testMobiles = [
      MOB_WORKER_APPROVED,
      MOB_WORKER_PENDING,
      MOB_WORKER_SUSPENDED,
      MOB_WORKER_EXPIRED_KYC,
      MOB_WORKER_INDEPENDENT,
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
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerInvitation.deleteMany({
        where: { invitedMobile: { in: testMobiles } },
      });
      await prisma.workerAvailability.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerDocument.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerSkill.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerProfile.deleteMany({
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
  // 1. Going Online / Offline Eligibility
  // ==========================================================================
  describe('1. Going Online & Offline Eligibility', () => {
    it('should allow approved, KYC-compliant worker to go ONLINE with coordinates', async () => {
      const result = await availabilityService.goOnline(workerApprovedUserId, {
        latitude: 12.9716,
        longitude: 77.5946,
      });

      expect(result).toBeDefined();
      expect(result.isOnline).toBe(true);
      expect(result.isBusy).toBe(false);
      expect(result.currentLatitude).toBeCloseTo(12.9716, 4);
      expect(result.currentLongitude).toBeCloseTo(77.5946, 4);
      expect(result.isStale).toBe(false);
    });

    it('should REJECT coordinates with out-of-range latitude (> 90 or < -90)', async () => {
      await expect(
        availabilityService.goOnline(workerApprovedUserId, {
          latitude: 95.0,
          longitude: 77.5946,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should REJECT coordinates with out-of-range longitude (> 180 or < -180)', async () => {
      await expect(
        availabilityService.goOnline(workerApprovedUserId, {
          latitude: 12.9716,
          longitude: 195.0,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should REJECT unapproved worker from going online', async () => {
      await expect(
        availabilityService.goOnline(workerPendingUserId)
      ).rejects.toThrow(ConflictError);
    });

    it('should REJECT suspended worker from going online', async () => {
      await expect(
        availabilityService.goOnline(workerSuspendedUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should REJECT worker with expired KYC document from going online', async () => {
      await expect(
        availabilityService.goOnline(workerExpiredKycUserId)
      ).rejects.toThrow(ConflictError);
    });

    it('should ALLOW independent worker without partner affiliation to go ONLINE (Rules 4 & 5)', async () => {
      const affiliationsCount = await prisma.workerPartnerAffiliation.count({
        where: { workerId: workerIndependentProfileId },
      });
      expect(affiliationsCount).toBe(0); // No affiliations!

      const result = await availabilityService.goOnline(workerIndependentUserId, {
        latitude: 19.076,
        longitude: 72.8777,
      });

      expect(result.isOnline).toBe(true);
      expect(result.isBusy).toBe(false);
    });

    it('should allow worker to go OFFLINE', async () => {
      const result = await availabilityService.goOffline(workerApprovedUserId);
      expect(result.isOnline).toBe(false);
      expect(result.isBusy).toBe(false);
    });

    it('should REJECT going offline when worker is currently marked busy', async () => {
      // Mark worker online & busy directly
      await availabilityRepo.updateDutyStatus(workerApprovedProfileId, true, true);

      await expect(
        availabilityService.goOffline(workerApprovedUserId)
      ).rejects.toThrow(ConflictError);

      // Reset to free
      await availabilityRepo.updateDutyStatus(workerApprovedProfileId, true, false);
    });
  });

  // ==========================================================================
  // 2. Heartbeat & Keep-Alive Behavior
  // ==========================================================================
  describe('2. Heartbeat & Keep-Alive Behavior', () => {
    it('should update heartbeat and coordinates for an online worker', async () => {
      const hb = await availabilityService.updateHeartbeat(workerApprovedUserId, {
        latitude: 12.972,
        longitude: 77.595,
      });

      expect(hb.isOnline).toBe(true);
      expect(hb.currentLatitude).toBeCloseTo(12.972, 3);
      expect(hb.currentLongitude).toBeCloseTo(77.595, 3);
      expect(hb.isStale).toBe(false);
    });

    it('should NOT automatically reactivate an offline worker through heartbeat (Rule 6)', async () => {
      // Worker goes offline
      await availabilityService.goOffline(workerApprovedUserId);

      // Offline worker sends heartbeat
      const hb = await availabilityService.updateHeartbeat(workerApprovedUserId, {
        latitude: 12.975,
        longitude: 77.598,
      });

      // Must STAY offline!
      expect(hb.isOnline).toBe(false);
    });

    it('should REJECT heartbeat from a suspended worker', async () => {
      await expect(
        availabilityService.updateHeartbeat(workerSuspendedUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should detect stale heartbeat if lastHeartbeatAt is older than 5 minutes', () => {
      const now = new Date();
      const freshDate = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago
      const staleDate = new Date(now.getTime() - 6 * 60 * 1000); // 6 minutes ago

      expect(availabilityService.isHeartbeatStale(freshDate, now)).toBe(false);
      expect(availabilityService.isHeartbeatStale(staleDate, now)).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Operational Availability & Dispatch Locking
  // ==========================================================================
  describe('3. Operational Availability & Dispatch Locking', () => {
    beforeEach(async () => {
      // Put approved worker online and free
      await availabilityService.goOnline(workerApprovedUserId, {
        latitude: 12.9716,
        longitude: 77.5946,
      });
    });

    it('should report operational and eligible for dispatch when online, free, and fresh', async () => {
      const op = await availabilityService.getOperationalAvailability(workerApprovedProfileId);
      expect(op.isOperational).toBe(true);
      expect(op.isEligible).toBe(true);
    });

    it('should report ineligible when heartbeat is stale (> 5 minutes)', async () => {
      const staleTime = new Date(Date.now() - 7 * 60 * 1000); // 7m ago
      await prisma.workerAvailability.update({
        where: { workerId: workerApprovedProfileId },
        data: { lastHeartbeatAt: staleTime },
      });

      const op = await availabilityService.getOperationalAvailability(workerApprovedProfileId);
      expect(op.isEligible).toBe(false);
      expect(op.reason).toContain('stale');
    });

    it('should acquire atomic dispatch lock and mark worker isBusy = true', async () => {
      // Refresh heartbeat
      await availabilityService.updateHeartbeat(workerApprovedUserId);

      const lockRes = await availabilityService.setDispatchLock(workerApprovedProfileId, {
        dispatchJobId: 'job_order_12345',
        ttlSeconds: 60,
      });

      expect(lockRes.acquired).toBe(true);
      expect(lockRes.lockId).toBeDefined();

      // Verify worker availability in database is now marked isBusy = true
      const dbAvail = await availabilityRepo.findByWorkerId(workerApprovedProfileId);
      expect(dbAvail?.isBusy).toBe(true);

      // Release lock
      const releaseRes = await availabilityService.releaseDispatchLock(
        workerApprovedProfileId,
        lockRes.lockId!
      );
      expect(releaseRes.released).toBe(true);

      const dbAvailAfter = await availabilityRepo.findByWorkerId(workerApprovedProfileId);
      expect(dbAvailAfter?.isBusy).toBe(false);
    });

    it('should prevent conflicting concurrent lock acquisition (Rule 8 & 9)', async () => {
      // Refresh heartbeat
      await availabilityService.updateHeartbeat(workerApprovedUserId);

      // Process 1 acquires lock
      const lock1 = await availabilityService.setDispatchLock(workerApprovedProfileId, {
        dispatchJobId: 'job_one',
      });
      expect(lock1.acquired).toBe(true);

      // Process 2 attempts to acquire lock on same worker -> BLOCKED
      const lock2 = await availabilityService.setDispatchLock(workerApprovedProfileId, {
        dispatchJobId: 'job_two',
      });
      expect(lock2.acquired).toBe(false);
      expect(lock2.reason).toContain('busy or locked');

      // Clean up by releasing lock 1
      await availabilityService.releaseDispatchLock(workerApprovedProfileId, lock1.lockId!);
    });

    it('should REJECT release of dispatch lock with mismatched token (Rule 10 & 11)', async () => {
      await availabilityService.updateHeartbeat(workerApprovedUserId);

      const lock = await availabilityService.setDispatchLock(workerApprovedProfileId);
      expect(lock.acquired).toBe(true);

      // Attempt to release with wrong lock token
      await expect(
        availabilityService.releaseDispatchLock(workerApprovedProfileId, 'wrong-token-abc')
      ).rejects.toThrow(ForbiddenError);

      // Correct token releases successfully
      const release = await availabilityService.releaseDispatchLock(
        workerApprovedProfileId,
        lock.lockId!
      );
      expect(release.released).toBe(true);
    });
  });
});
