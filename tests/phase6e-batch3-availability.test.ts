import { prisma } from '../src/config/db.config';
import {
  WorkerAvailabilityService,
  workerAvailabilityService,
} from '../src/modules/workers/services/worker-availability.service';
import {
  WorkerAvailabilityRepository,
  WorkerProfileRepository,
  WorkerDocumentRepository,
  WorkerSkillRepository,
} from '../src/modules/workers/repositories';
import {
  DefaultWorkerKycPolicyProvider,
  WorkerKycValidationService,
} from '../src/modules/workers/services/worker-kyc.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6E Batch 3: Worker Availability & Heartbeat Management', () => {
  const availabilityService = workerAvailabilityService;
  const availabilityRepo = new WorkerAvailabilityRepository();
  const profileRepo = new WorkerProfileRepository();
  const documentRepo = new WorkerDocumentRepository();

  // Test mobile numbers
  const MOB_AVAIL_APPROVED = '+919922000001';
  const MOB_AVAIL_UNAPPROVED = '+919922000002';
  const MOB_AVAIL_SUSPENDED = '+919922000003';
  const MOB_AVAIL_EXPIRED_KYC = '+919922000004';
  const MOB_AVAIL_INDEPENDENT = '+919922000005';

  let approvedUserId: bigint;
  let approvedProfileId: bigint;

  let unapprovedUserId: bigint;
  let unapprovedProfileId: bigint;

  let suspendedUserId: bigint;
  let suspendedProfileId: bigint;

  let expiredKycUserId: bigint;
  let expiredKycProfileId: bigint;

  let independentUserId: bigint;
  let independentProfileId: bigint;

  beforeAll(async () => {
    // 1. Cleanup
    const testMobiles = [
      MOB_AVAIL_APPROVED,
      MOB_AVAIL_UNAPPROVED,
      MOB_AVAIL_SUSPENDED,
      MOB_AVAIL_EXPIRED_KYC,
      MOB_AVAIL_INDEPENDENT,
    ];

    const existingUsers = await prisma.user.findMany({
      where: { mobileNumber: { in: testMobiles } },
      select: { id: true },
    });
    const userIds = existingUsers.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.workerPartnerAffiliation.deleteMany({
        where: { worker: { userId: { in: userIds } } },
      });
      await prisma.workerInvitation.deleteMany({
        where: {
          OR: [
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
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }

    // 2. Roles Setup
    const workerRole =
      (await prisma.role.findUnique({ where: { roleName: 'WORKER' } })) ||
      (await prisma.role.create({
        data: { roleName: 'WORKER', description: 'Worker' },
      }));

    // Future date for valid documents (30 days from now)
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    // Past date for expired documents (5 days ago)
    const pastExpiry = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    // 3. Seed Approved Worker (HELPER with approved IDENTITY_PROOF)
    const userApproved = await prisma.user.create({
      data: { mobileNumber: MOB_AVAIL_APPROVED, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    approvedUserId = userApproved.id;
    await prisma.userRole.create({ data: { userId: approvedUserId, roleId: workerRole.id } });
    const pApproved = await prisma.workerProfile.create({
      data: {
        userId: approvedUserId,
        firstName: 'Approved',
        lastName: 'Worker',
        workerType: 'HELPER',
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });
    approvedProfileId = pApproved.id;
    await prisma.workerDocument.create({
      data: {
        workerId: approvedProfileId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: 'private/workers/docs/aadhar1.pdf',
        originalName: 'aadhar1.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1024),
        verificationStatus: 'VERIFIED',
        expiryDate: futureExpiry,
      },
    });

    // 4. Seed Unapproved Worker (PENDING)
    const userUnapproved = await prisma.user.create({
      data: { mobileNumber: MOB_AVAIL_UNAPPROVED, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    unapprovedUserId = userUnapproved.id;
    await prisma.userRole.create({ data: { userId: unapprovedUserId, roleId: workerRole.id } });
    const pUnapproved = await prisma.workerProfile.create({
      data: {
        userId: unapprovedUserId,
        firstName: 'Unapproved',
        lastName: 'Worker',
        workerType: 'HELPER',
        approvalStatus: 'PENDING',
        isActive: true,
      },
    });
    unapprovedProfileId = pUnapproved.id;

    // 5. Seed Suspended Worker
    const userSuspended = await prisma.user.create({
      data: { mobileNumber: MOB_AVAIL_SUSPENDED, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    suspendedUserId = userSuspended.id;
    await prisma.userRole.create({ data: { userId: suspendedUserId, roleId: workerRole.id } });
    const pSuspended = await prisma.workerProfile.create({
      data: {
        userId: suspendedUserId,
        firstName: 'Suspended',
        lastName: 'Worker',
        workerType: 'HELPER',
        approvalStatus: 'APPROVED',
        isActive: true,
        suspendedAt: new Date(),
      },
    });
    suspendedProfileId = pSuspended.id;
    await prisma.workerDocument.create({
      data: {
        workerId: suspendedProfileId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: 'private/workers/docs/aadhar3.pdf',
        originalName: 'aadhar3.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1024),
        verificationStatus: 'VERIFIED',
        expiryDate: futureExpiry,
      },
    });

    // 6. Seed Worker with Expired KYC Document
    const userExpiredKyc = await prisma.user.create({
      data: { mobileNumber: MOB_AVAIL_EXPIRED_KYC, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    expiredKycUserId = userExpiredKyc.id;
    await prisma.userRole.create({ data: { userId: expiredKycUserId, roleId: workerRole.id } });
    const pExpired = await prisma.workerProfile.create({
      data: {
        userId: expiredKycUserId,
        firstName: 'Expired',
        lastName: 'Worker',
        workerType: 'HELPER',
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });
    expiredKycProfileId = pExpired.id;
    await prisma.workerDocument.create({
      data: {
        workerId: expiredKycProfileId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: 'private/workers/docs/aadhar4.pdf',
        originalName: 'aadhar4.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1024),
        verificationStatus: 'VERIFIED',
        expiryDate: pastExpiry, // EXPIRED!
      },
    });

    // 7. Seed Independent Worker (No partner affiliations, Approved KYC)
    const userIndependent = await prisma.user.create({
      data: { mobileNumber: MOB_AVAIL_INDEPENDENT, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    independentUserId = userIndependent.id;
    await prisma.userRole.create({ data: { userId: independentUserId, roleId: workerRole.id } });
    const pIndependent = await prisma.workerProfile.create({
      data: {
        userId: independentUserId,
        firstName: 'Independent',
        lastName: 'Worker',
        workerType: 'HELPER',
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });
    independentProfileId = pIndependent.id;
    await prisma.workerDocument.create({
      data: {
        workerId: independentProfileId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: 'private/workers/docs/aadhar5.pdf',
        originalName: 'aadhar5.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1024),
        verificationStatus: 'VERIFIED',
        expiryDate: futureExpiry,
      },
    });
  });

  afterAll(async () => {
    const testMobiles = [
      MOB_AVAIL_APPROVED,
      MOB_AVAIL_UNAPPROVED,
      MOB_AVAIL_SUSPENDED,
      MOB_AVAIL_EXPIRED_KYC,
      MOB_AVAIL_INDEPENDENT,
    ];
    const existingUsers = await prisma.user.findMany({
      where: { mobileNumber: { in: testMobiles } },
      select: { id: true },
    });
    const userIds = existingUsers.map((u) => u.id);
    if (userIds.length > 0) {
      await prisma.workerPartnerAffiliation.deleteMany({
        where: { worker: { userId: { in: userIds } } },
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
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  });

  // ============================================================================
  // 1. Initial State & Retrieval
  // ============================================================================
  describe('1. Initial State & Retrieval', () => {
    it('should return default offline availability when worker has no prior availability row', async () => {
      const avail = await availabilityService.getMyAvailability(approvedUserId);
      expect(avail).toBeDefined();
      expect(avail.workerId).toBe(approvedProfileId.toString());
      expect(avail.isOnline).toBe(false);
      expect(avail.isBusy).toBe(false);
    });

    it('should throw NotFoundError for non-existent worker profile', async () => {
      await expect(
        availabilityService.getMyAvailability(BigInt(999999999))
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ============================================================================
  // 2. goOnline State Machine & Eligibility Guards
  // ============================================================================
  describe('2. goOnline State Machine & Eligibility Guards', () => {
    it('should reject goOnline if worker profile is unapproved (PENDING)', async () => {
      await expect(
        availabilityService.goOnline(unapprovedUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject goOnline if worker profile is suspended', async () => {
      await expect(
        availabilityService.goOnline(suspendedUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject goOnline if mandatory KYC document is expired', async () => {
      await expect(
        availabilityService.goOnline(expiredKycUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject goOnline if coordinates are out of valid geographic range', async () => {
      // Latitude > 90
      await expect(
        availabilityService.goOnline(approvedUserId, {
          latitude: 95.0,
          longitude: 77.0,
        })
      ).rejects.toThrow(BadRequestError);

      // Longitude > 180
      await expect(
        availabilityService.goOnline(approvedUserId, {
          latitude: 12.0,
          longitude: 195.0,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should allow independent worker (no partner affiliation) with valid KYC to go online', async () => {
      const result = await availabilityService.goOnline(independentUserId, {
        latitude: 12.9716,
        longitude: 77.5946,
      });

      expect(result.isOnline).toBe(true);
      expect(result.isBusy).toBe(false);
      expect(result.currentLatitude).toBe(12.9716);
      expect(result.currentLongitude).toBe(77.5946);
      expect(result.lastHeartbeatAt).toBeDefined();
    });

    it('should allow approved worker with valid KYC to go online', async () => {
      const result = await availabilityService.goOnline(approvedUserId, {
        latitude: 28.6139,
        longitude: 77.209,
      });

      expect(result.isOnline).toBe(true);
      expect(result.isBusy).toBe(false);
      expect(result.currentLatitude).toBe(28.6139);
      expect(result.currentLongitude).toBe(77.209);
      expect(result.lastHeartbeatAt).toBeDefined();
    });
  });

  // ============================================================================
  // 3. Heartbeat & goOffline Lifecycle
  // ============================================================================
  describe('3. Heartbeat & goOffline Lifecycle', () => {
    it('should update heartbeat and coordinates while worker is online', async () => {
      const beforeTime = new Date();
      const updated = await availabilityService.updateHeartbeat(approvedUserId, {
        latitude: 28.6145,
        longitude: 77.2095,
      });

      expect(updated.isOnline).toBe(true);
      expect(updated.currentLatitude).toBe(28.6145);
      expect(updated.currentLongitude).toBe(77.2095);
      expect(new Date(updated.lastHeartbeatAt!).getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    });

    it('should allow worker to toggle offline', async () => {
      const result = await availabilityService.goOffline(approvedUserId);
      expect(result.isOnline).toBe(false);
      expect(result.isBusy).toBe(false);
    });

    it('should NOT silently bring worker online when sending heartbeat while offline', async () => {
      // Worker is currently offline
      const current = await availabilityService.getMyAvailability(approvedUserId);
      expect(current.isOnline).toBe(false);

      // Send heartbeat
      const heartbeatResult = await availabilityService.updateHeartbeat(approvedUserId, {
        latitude: 28.62,
        longitude: 77.21,
      });

      // Crucial requirement: isOnline MUST remain false!
      expect(heartbeatResult.isOnline).toBe(false);
      expect(heartbeatResult.currentLatitude).toBe(28.62);
      expect(heartbeatResult.currentLongitude).toBe(77.21);
    });

    it('should reject heartbeat update if worker is suspended', async () => {
      await expect(
        availabilityService.updateHeartbeat(suspendedUserId, {
          latitude: 12.0,
          longitude: 77.0,
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ============================================================================
  // 4. Operational Availability & Dispatch Status Evaluation
  // ============================================================================
  describe('4. Operational Availability & Dispatch Status Evaluation', () => {
    it('should evaluate status as OFFLINE when worker is offline', async () => {
      const status = await availabilityService.getOperationalAvailability(approvedUserId);
      expect(status.isOnline).toBe(false);
      expect(status.isOperationallyAvailable).toBe(false);
      expect(status.reasonsIfNotAvailable).toContain('Worker is currently offline');
    });

    it('should evaluate status as ONLINE_AVAILABLE when worker is online with fresh heartbeat', async () => {
      await availabilityService.goOnline(approvedUserId, { latitude: 28.6139, longitude: 77.209 });
      const status = await availabilityService.getOperationalAvailability(approvedUserId);

      expect(status.isOnline).toBe(true);
      expect(status.isBusy).toBe(false);
      expect(status.isStale).toBe(false);
      expect(status.isOperationallyAvailable).toBe(true);
      expect(status.reasonsIfNotAvailable.length).toBe(0);
    });

    it('should evaluate status as BUSY when worker is online and marked busy', async () => {
      // Mark busy in DB
      await availabilityRepo.updateDutyStatus(approvedProfileId, true, true);

      const status = await availabilityService.getOperationalAvailability(approvedUserId);
      expect(status.isOnline).toBe(true);
      expect(status.isBusy).toBe(true);
      expect(status.isOperationallyAvailable).toBe(false);
      expect(status.reasonsIfNotAvailable).toContain('Worker is currently busy on an active task');

      // Revert busy status
      await availabilityRepo.updateDutyStatus(approvedProfileId, true, false);
    });

    it('should evaluate status as STALE_OFFLINE when last heartbeat is older than 5 minutes', async () => {
      // Backdate heartbeat to 10 minutes ago
      const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
      await prisma.workerAvailability.update({
        where: { workerId: approvedProfileId },
        data: {
          lastHeartbeatAt: staleTimestamp,
        },
      });

      const status = await availabilityService.getOperationalAvailability(approvedUserId);
      expect(status.isStale).toBe(true);
      expect(status.isOperationallyAvailable).toBe(false);
      expect(status.reasonsIfNotAvailable).toContain('Worker heartbeat is stale (> 5 minutes elapsed)');
    });
  });

  // ============================================================================
  // 5. Dispatch Lock Concurrency & Owner Verification
  // ============================================================================
  describe('5. Dispatch Lock Concurrency & Owner Verification', () => {
    const lockTokenA = 'dispatcher-job-12345';
    const lockTokenB = 'dispatcher-job-67890';

    beforeEach(async () => {
      // Release any lingering locks for approvedProfileId
      await availabilityService.releaseDispatchLock(approvedProfileId, {
        lockOwner: lockTokenA,
        forceRelease: true,
      });
      await availabilityService.releaseDispatchLock(approvedProfileId, {
        lockOwner: lockTokenB,
        forceRelease: true,
      });
    });

    it('should acquire dispatch lock atomically with TTL', async () => {
      const lockResult = await availabilityService.setDispatchLock(approvedProfileId, {
        lockOwner: lockTokenA,
        ttlSeconds: 60,
      });

      expect(lockResult.acquired).toBe(true);
      expect(lockResult.lockOwner).toBe(lockTokenA);
    });

    it('should reject concurrent lock acquisition attempt while lock is active', async () => {
      // First acquire lock A
      const first = await availabilityService.setDispatchLock(approvedProfileId, {
        lockOwner: lockTokenA,
        ttlSeconds: 60,
      });
      expect(first.acquired).toBe(true);

      // Second attempt by lock B must fail
      const second = await availabilityService.setDispatchLock(approvedProfileId, {
        lockOwner: lockTokenB,
        ttlSeconds: 60,
      });
      expect(second.acquired).toBe(false);
      expect(second.existingLockOwner).toBe(lockTokenA);
    });

    it('should reject release attempt with wrong lock owner token', async () => {
      // Acquire lock A
      await availabilityService.setDispatchLock(approvedProfileId, {
        lockOwner: lockTokenA,
        ttlSeconds: 60,
      });

      // Release attempt with lockOwner B fails
      const releaseResult = await availabilityService.releaseDispatchLock(approvedProfileId, {
        lockOwner: lockTokenB,
      });
      expect(releaseResult.released).toBe(false);

      // Release with correct owner A succeeds
      const properRelease = await availabilityService.releaseDispatchLock(approvedProfileId, {
        lockOwner: lockTokenA,
      });
      expect(properRelease.released).toBe(true);
    });

    it('should allow force release of dispatch lock regardless of owner', async () => {
      // Acquire lock A
      await availabilityService.setDispatchLock(approvedProfileId, {
        lockOwner: lockTokenA,
        ttlSeconds: 60,
      });

      // Force release
      const forced = await availabilityService.releaseDispatchLock(approvedProfileId, {
        lockOwner: 'unknown-entity',
        forceRelease: true,
      });
      expect(forced.released).toBe(true);

      // Lock B can now acquire cleanly
      const nextAcquisition = await availabilityService.setDispatchLock(approvedProfileId, {
        lockOwner: lockTokenB,
        ttlSeconds: 60,
      });
      expect(nextAcquisition.acquired).toBe(true);
    });
  });
});
