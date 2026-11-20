import { prisma } from '../src/config/db.config';
import {
  WorkerInvitationService,
  workerInvitationService,
} from '../src/modules/workers/services/worker-invitation.service';
import {
  WorkerAffiliationService,
  workerAffiliationService,
} from '../src/modules/workers/services/worker-affiliation.service';
import {
  WorkerProfileRepository,
  WorkerInvitationRepository,
  WorkerPartnerAffiliationRepository,
} from '../src/modules/workers/repositories';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6E Batch 3: Worker Invitations Service', () => {
  const invitationService = workerInvitationService;
  const affiliationService = workerAffiliationService;

  const profileRepo = new WorkerProfileRepository();
  const invitationRepo = new WorkerInvitationRepository();
  const affiliationRepo = new WorkerPartnerAffiliationRepository();

  // Test mobile numbers
  const MOB_PARTNER_A = '+919911000001';
  const MOB_PARTNER_B = '+919911000002';
  const MOB_PARTNER_UNAPPROVED = '+919911000003';
  const MOB_WORKER_1 = '+919911000004';
  const MOB_WORKER_2 = '+919911000005';
  const MOB_WORKER_NO_PROFILE = '+919911000006';

  let partnerAUserId: bigint;
  let partnerBUserId: bigint;
  let partnerUnapprovedUserId: bigint;
  let partnerAId: bigint;
  let partnerBId: bigint;
  let partnerUnapprovedId: bigint;

  let worker1UserId: bigint;
  let worker1ProfileId: bigint;

  let worker2UserId: bigint;
  let worker2ProfileId: bigint;

  let workerNoProfileUserId: bigint;

  beforeAll(async () => {
    const testMobiles = [
      MOB_PARTNER_A,
      MOB_PARTNER_B,
      MOB_PARTNER_UNAPPROVED,
      MOB_WORKER_1,
      MOB_WORKER_2,
      MOB_WORKER_NO_PROFILE,
    ];

    // Cleanup existing test records
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

    // Ensure roles exist
    const partnerRole =
      (await prisma.role.findUnique({ where: { roleName: 'PARTNER' } })) ||
      (await prisma.role.create({ data: { roleName: 'PARTNER', description: 'Partner' } }));
    const workerRole =
      (await prisma.role.findUnique({ where: { roleName: 'WORKER' } })) ||
      (await prisma.role.create({ data: { roleName: 'WORKER', description: 'Worker' } }));
    const customerRole =
      (await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } })) ||
      (await prisma.role.create({ data: { roleName: 'CUSTOMER', description: 'Customer' } }));

    // Setup Partner A (APPROVED)
    const uPartnerA = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER_A, isMobileVerified: true },
    });
    partnerAUserId = uPartnerA.id;
    await prisma.userRole.create({ data: { userId: partnerAUserId, roleId: partnerRole.id } });
    const pA = await prisma.partnerProfile.create({
      data: {
        userId: partnerAUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Alpha Services Partner',
        businessName: 'Alpha Trades',
        approvalStatus: 'APPROVED',
      },
    });
    partnerAId = pA.id;

    // Setup Partner B (APPROVED)
    const uPartnerB = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER_B, isMobileVerified: true },
    });
    partnerBUserId = uPartnerB.id;
    await prisma.userRole.create({ data: { userId: partnerBUserId, roleId: partnerRole.id } });
    const pB = await prisma.partnerProfile.create({
      data: {
        userId: partnerBUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Beta Services Partner',
        businessName: 'Beta Trades',
        approvalStatus: 'APPROVED',
      },
    });
    partnerBId = pB.id;

    // Setup Partner Unapproved (PENDING)
    const uPartnerUnapp = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER_UNAPPROVED, isMobileVerified: true },
    });
    partnerUnapprovedUserId = uPartnerUnapp.id;
    await prisma.userRole.create({ data: { userId: partnerUnapprovedUserId, roleId: partnerRole.id } });
    const pUnapp = await prisma.partnerProfile.create({
      data: {
        userId: partnerUnapprovedUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Pending Partner',
        businessName: 'Pending Services',
        approvalStatus: 'PENDING',
      },
    });
    partnerUnapprovedId = pUnapp.id;

    // Setup Worker 1 (with Profile & CUSTOMER role)
    const uWorker1 = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_1, isMobileVerified: true },
    });
    worker1UserId = uWorker1.id;
    await prisma.userRole.create({ data: { userId: worker1UserId, roleId: customerRole.id } });
    const prof1 = await profileRepo.create({
      userId: worker1UserId,
      firstName: 'Ramesh',
      lastName: 'Kumar',
      workerType: 'TECHNICIAN',
      submissionStatus: 'DRAFT',
      approvalStatus: 'PENDING',
    });
    worker1ProfileId = prof1.id;

    // Setup Worker 2 (with Profile)
    const uWorker2 = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_2, isMobileVerified: true },
    });
    worker2UserId = uWorker2.id;
    await prisma.userRole.create({ data: { userId: worker2UserId, roleId: customerRole.id } });
    const prof2 = await profileRepo.create({
      userId: worker2UserId,
      firstName: 'Suresh',
      lastName: 'Patel',
      workerType: 'HELPER',
      submissionStatus: 'DRAFT',
      approvalStatus: 'PENDING',
    });
    worker2ProfileId = prof2.id;

    // Setup Worker with NO Profile (Registered user only)
    const uWorkerNoProf = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_NO_PROFILE, isMobileVerified: true },
    });
    workerNoProfileUserId = uWorkerNoProf.id;
    await prisma.userRole.create({ data: { userId: workerNoProfileUserId, roleId: customerRole.id } });
  });

  afterAll(async () => {
    const testMobiles = [
      MOB_PARTNER_A,
      MOB_PARTNER_B,
      MOB_PARTNER_UNAPPROVED,
      MOB_WORKER_1,
      MOB_WORKER_2,
      MOB_WORKER_NO_PROFILE,
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
  // 1. Partner Invitation Creation & Validation
  // ==========================================================================
  describe('1. Partner Invitation Creation & Security', () => {
    let createdInvitationId: string;
    let createdRawToken: string;

    it('should allow an active approved partner to invite a worker', async () => {
      const result = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: '9911000004', // 10 digits without +91
        workerName: 'Ramesh',
        proposedRole: 'LEAD_TECHNICIAN',
        notes: 'Invitation to join Alpha Trades',
      });

      expect(result).toBeDefined();
      expect(result.invitationToken).toBeDefined();
      expect(result.invitationToken.length).toBe(64); // 32 bytes hex
      expect(result.invitation.invitedMobile).toBe(MOB_WORKER_1); // Normalized to +91
      expect(result.invitation.invitationStatus).toBe('PENDING');
      expect(result.invitation.resendCount).toBe(0);

      createdInvitationId = result.invitation.id;
      createdRawToken = result.invitationToken;

      // Verify PostgreSQL holds ONLY the SHA-256 hash, not the raw token
      const dbRecord = await prisma.workerInvitation.findUnique({
        where: { id: BigInt(createdInvitationId) },
      });
      expect(dbRecord?.invitationTokenHash).toBe(invitationService.hashToken(createdRawToken));
      expect((dbRecord as any).invitationToken).toBeUndefined();
    });

    it('should reject unapproved partner from inviting workers', async () => {
      await expect(
        invitationService.createInvitation(partnerUnapprovedUserId, {
          invitedMobile: MOB_WORKER_2,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject non-partner user from inviting workers', async () => {
      await expect(
        invitationService.createInvitation(worker1UserId, {
          invitedMobile: MOB_WORKER_2,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject duplicate pending invitation from SAME partner to SAME mobile', async () => {
      await expect(
        invitationService.createInvitation(partnerAUserId, {
          invitedMobile: MOB_WORKER_1,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should ALLOW a DIFFERENT partner to invite the SAME mobile simultaneously', async () => {
      const result = await invitationService.createInvitation(partnerBUserId, {
        invitedMobile: MOB_WORKER_1,
        workerName: 'Ramesh Kumar',
        notes: 'Invitation from Beta Trades',
      });

      expect(result).toBeDefined();
      expect(result.invitation.partnerId).toBe(partnerBId.toString());
      expect(result.invitation.invitedMobile).toBe(MOB_WORKER_1);
      expect(result.invitation.invitationStatus).toBe('PENDING');
    });

    it('should reject invalid mobile number formats', async () => {
      await expect(
        invitationService.createInvitation(partnerAUserId, {
          invitedMobile: 'invalid-number',
        })
      ).rejects.toThrow(BadRequestError);

      await expect(
        invitationService.createInvitation(partnerAUserId, {
          invitedMobile: '12345',
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should set expiry to exactly 7 full calendar days using Asia/Kolkata', async () => {
      const now = new Date();
      const expiresAt = invitationService.calculate7DayExpiryIST(now);
      const diffMs = expiresAt.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeGreaterThanOrEqual(6.8);
      expect(diffDays).toBeLessThanOrEqual(8.0);
    });
  });

  // ==========================================================================
  // 2. Invitation Retrieval & Listing
  // ==========================================================================
  describe('2. Invitation Retrieval & Listing', () => {
    it('should allow partner to list their own sent invitations', async () => {
      const result = await invitationService.listPartnerInvitations(partnerAUserId);
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some((i) => i.partnerId === partnerAId.toString())).toBe(true);
    });

    it('should allow worker to list invitations received for their mobile', async () => {
      const result = await invitationService.listWorkerInvitations(worker1UserId);
      expect(result.items.length).toBeGreaterThanOrEqual(2); // One from Partner A, one from Partner B
      expect(result.items.some((i) => i.partnerId === partnerAId.toString())).toBe(true);
      expect(result.items.some((i) => i.partnerId === partnerBId.toString())).toBe(true);
    });

    it('should lookup public invitation details by raw token without authentication', async () => {
      // Create invitation to get fresh token
      const created = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_2,
      });

      const details = (await invitationService.getInvitationDetails(
        created.invitationToken
      )) as any;

      expect(details).toBeDefined();
      expect(details.partnerId).toBe(partnerAId.toString());
      expect(details.invitedMobile).toBe(MOB_WORKER_2);
      expect(details.invitationStatus).toBe('PENDING');
      // Must not leak token hash or raw token
      expect(details.invitationTokenHash).toBeUndefined();
      expect(details.invitationToken).toBeUndefined();
    });

    it('should enforce tenant isolation on numeric ID lookup', async () => {
      const partnerAInvitations = await invitationService.listPartnerInvitations(partnerAUserId);
      const invitationId = partnerAInvitations.items[0].id;

      // Partner B attempting to inspect Partner A's invitation by ID should be blocked
      await expect(
        invitationService.getInvitationDetails(invitationId, partnerBUserId)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ==========================================================================
  // 3. Explicit Worker Acceptance & Role Preservation
  // ==========================================================================
  describe('3. Explicit Worker Acceptance', () => {
    let invitationForWorker1: { invitation: any; invitationToken: string };

    beforeEach(async () => {
      // Ensure clean pending invitation from Partner A to Worker 1
      await prisma.workerPartnerAffiliation.deleteMany({
        where: { workerId: worker1ProfileId, partnerId: partnerAId },
      });
      await prisma.workerInvitation.deleteMany({
        where: { partnerId: partnerAId, invitedMobile: MOB_WORKER_1 },
      });

      invitationForWorker1 = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_1,
        workerName: 'Ramesh Kumar',
      });
    });

    it('should REJECT acceptance if authenticated user mobile does not match target', async () => {
      // Worker 2 attempts to accept invitation targeted to Worker 1
      await expect(
        invitationService.acceptInvitation(invitationForWorker1.invitation.id, worker2UserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should REJECT acceptance if worker has no existing worker profile (Rule 16)', async () => {
      // Create invitation targeted to Worker with No Profile
      const invNoProf = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_NO_PROFILE,
      });

      await expect(
        invitationService.acceptInvitation(invNoProf.invitation.id, workerNoProfileUserId)
      ).rejects.toThrow(BadRequestError);
    });

    it('should successfully accept invitation, create affiliation, and preserve roles', async () => {
      // Worker 1 has CUSTOMER role initially
      const userRolesBefore = await prisma.userRole.findMany({
        where: { userId: worker1UserId },
        include: { role: true },
      });
      expect(userRolesBefore.some((ur) => ur.role.roleName === 'CUSTOMER')).toBe(true);

      const acceptResult = await invitationService.acceptInvitation(
        invitationForWorker1.invitation.id,
        worker1UserId
      );

      expect(acceptResult).toBeDefined();
      expect(acceptResult.invitation.invitationStatus).toBe('ACCEPTED');
      expect(acceptResult.affiliationId).toBeDefined();
      expect(acceptResult.workerProfileId).toBe(worker1ProfileId.toString());

      // Verify active affiliation created in DB
      const affiliation = await prisma.workerPartnerAffiliation.findUnique({
        where: { id: BigInt(acceptResult.affiliationId) },
      });
      expect(affiliation).toBeDefined();
      expect(affiliation?.affiliationStatus).toBe('ACTIVE');
      expect(affiliation?.workerId).toBe(worker1ProfileId);
      expect(affiliation?.partnerId).toBe(partnerAId);

      // Verify role preservation: user STILL has CUSTOMER and now ALSO has WORKER
      const userRolesAfter = await prisma.userRole.findMany({
        where: { userId: worker1UserId },
        include: { role: true },
      });
      const roleNames = userRolesAfter.map((ur) => ur.role.roleName);
      expect(roleNames).toContain('CUSTOMER');
      expect(roleNames).toContain('WORKER');

      // Verify worker profile approvalStatus was NOT automatically approved (Rule 18)
      const profileAfter = await profileRepo.findById(worker1ProfileId);
      expect(profileAfter?.approvalStatus).toBe('PENDING');

      // Verify atomic audit log created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          actorUserId: worker1UserId,
          action: 'WORKER_INVITATION_ACCEPTED',
          entityId: BigInt(acceptResult.affiliationId),
        },
      });
      expect(auditLog).toBeDefined();
    });

    it('should REJECT replayed acceptance on an already ACCEPTED invitation', async () => {
      // Accept first time
      await invitationService.acceptInvitation(invitationForWorker1.invitation.id, worker1UserId);

      // Attempt to accept second time
      await expect(
        invitationService.acceptInvitation(invitationForWorker1.invitation.id, worker1UserId)
      ).rejects.toThrow(ConflictError);
    });

    it('should REJECT acceptance of an EXPIRED invitation', async () => {
      // Expire invitation directly in database
      await prisma.workerInvitation.update({
        where: { id: BigInt(invitationForWorker1.invitation.id) },
        data: { expiresAt: new Date(Date.now() - 1000 * 60) }, // 1 minute in the past
      });

      await expect(
        invitationService.acceptInvitation(invitationForWorker1.invitation.id, worker1UserId)
      ).rejects.toThrow(BadRequestError);
    });

    it('should REJECT acceptance of a REVOKED invitation', async () => {
      // Revoke invitation
      await invitationService.revokeInvitation(partnerAUserId, invitationForWorker1.invitation.id);

      await expect(
        invitationService.acceptInvitation(invitationForWorker1.invitation.id, worker1UserId)
      ).rejects.toThrow(ConflictError);
    });
  });

  // ==========================================================================
  // 4. Rejection, Revocation & Resend Lifecycle
  // ==========================================================================
  describe('4. Rejection, Revocation & Resend Lifecycle', () => {
    it('should allow worker to explicitly reject an invitation with reason', async () => {
      // Clean and create new invitation from Partner B to Worker 2
      await prisma.workerInvitation.deleteMany({
        where: { partnerId: partnerBId, invitedMobile: MOB_WORKER_2 },
      });

      const inv = await invitationService.createInvitation(partnerBUserId, {
        invitedMobile: MOB_WORKER_2,
      });

      const rejected = await invitationService.rejectInvitation(
        inv.invitation.id,
        worker2UserId,
        'Not interested in home electrical projects currently'
      );

      expect(rejected.invitationStatus).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Not interested in home electrical projects currently');
      expect(rejected.respondedAt).toBeDefined();
    });

    it('should allow partner to revoke their own pending invitation', async () => {
      await prisma.workerInvitation.deleteMany({
        where: { partnerId: partnerAId, invitedMobile: MOB_WORKER_2 },
      });

      const inv = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_2,
      });

      const revoked = await invitationService.revokeInvitation(
        partnerAUserId,
        inv.invitation.id,
        'Position filled by internal technician'
      );

      expect(revoked.invitationStatus).toBe('REVOKED');
      expect(revoked.rejectionReason).toBe('Position filled by internal technician');
      expect(revoked.revokedAt).toBeDefined();
    });

    it('should prevent cross-partner revocation (Partner B cannot revoke Partner A invitation)', async () => {
      await prisma.workerInvitation.deleteMany({
        where: { partnerId: partnerAId, invitedMobile: MOB_WORKER_2 },
      });

      const inv = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_2,
      });

      await expect(
        invitationService.revokeInvitation(partnerBUserId, inv.invitation.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow partner to resend invitation: rotates token, extends expiry, increments resendCount', async () => {
      await prisma.workerInvitation.deleteMany({
        where: { partnerId: partnerAId, invitedMobile: MOB_WORKER_2 },
      });

      const initial = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_2,
      });

      const resent = await invitationService.resendInvitation(partnerAUserId, initial.invitation.id);

      expect(resent.invitation.resendCount).toBe(1);
      expect(resent.invitationToken).toBeDefined();
      expect(resent.invitationToken).not.toBe(initial.invitationToken); // Rotated token

      // Verify token hash in DB corresponds to NEW raw token
      const dbRecord = await prisma.workerInvitation.findUnique({
        where: { id: BigInt(initial.invitation.id) },
      });
      expect(dbRecord?.invitationTokenHash).toBe(invitationService.hashToken(resent.invitationToken));
      expect(dbRecord?.resendCount).toBe(1);
    });

    it('should batch expire past pending invitations', async () => {
      // Set an invitation's expiresAt into the past
      const created = await invitationService.createInvitation(partnerBUserId, {
        invitedMobile: MOB_WORKER_2,
      });

      await prisma.workerInvitation.update({
        where: { id: BigInt(created.invitation.id) },
        data: { expiresAt: new Date(Date.now() - 5000) },
      });

      const expiredCount = await invitationService.expireInvitations();
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const updated = await invitationRepo.findById(BigInt(created.invitation.id));
      expect(updated?.invitationStatus).toBe('EXPIRED');
    });
  });
});
