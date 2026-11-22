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
  WorkerInvitationRepository,
  WorkerPartnerAffiliationRepository,
  WorkerProfileRepository,
} from '../src/modules/workers/repositories';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '../src/common/errors';
import { DateUtil } from '../src/common/utils/date.util';

describe('Phase 6E Batch 3: Worker Invitations & Multi-Partner Affiliations', () => {
  const invitationService = workerInvitationService;
  const affiliationService = workerAffiliationService;

  const invitationRepo = new WorkerInvitationRepository();
  const affiliationRepo = new WorkerPartnerAffiliationRepository();
  const profileRepo = new WorkerProfileRepository();

  // Test mobile numbers
  const MOB_APPROVED_PARTNER_A = '+919911000001';
  const MOB_APPROVED_PARTNER_B = '+919911000002';
  const MOB_PENDING_PARTNER = '+919911000003';
  const MOB_SUSPENDED_PARTNER = '+919911000004';

  const MOB_WORKER_1 = '+919911000011';
  const MOB_WORKER_2 = '+919911000012';
  const MOB_WORKER_3 = '+919911000014';
  const MOB_WORKER_4 = '+919911000015';
  const MOB_WORKER_NO_PROFILE = '+919911000013';

  let partnerAUserId: bigint;
  let partnerBUserId: bigint;
  let pendingPartnerUserId: bigint;
  let suspendedPartnerUserId: bigint;

  let partnerAProfileId: bigint;
  let partnerBProfileId: bigint;

  let worker1UserId: bigint;
  let worker1ProfileId: bigint;

  let worker2UserId: bigint;
  let worker2ProfileId: bigint;

  let worker3UserId: bigint;
  let worker3ProfileId: bigint;

  let worker4UserId: bigint;
  let worker4ProfileId: bigint;

  let workerNoProfileUserId: bigint;

  beforeAll(async () => {
    // 1. Comprehensive Cleanup of Test Records
    const testMobiles = [
      MOB_APPROVED_PARTNER_A,
      MOB_APPROVED_PARTNER_B,
      MOB_PENDING_PARTNER,
      MOB_SUSPENDED_PARTNER,
      MOB_WORKER_1,
      MOB_WORKER_2,
      MOB_WORKER_3,
      MOB_WORKER_4,
      MOB_WORKER_NO_PROFILE,
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
    const partnerRole =
      (await prisma.role.findUnique({ where: { roleName: 'PARTNER' } })) ||
      (await prisma.role.create({
        data: { roleName: 'PARTNER', description: 'Partner' },
      }));
    const workerRole =
      (await prisma.role.findUnique({ where: { roleName: 'WORKER' } })) ||
      (await prisma.role.create({
        data: { roleName: 'WORKER', description: 'Worker' },
      }));
    const customerRole =
      (await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } })) ||
      (await prisma.role.create({
        data: { roleName: 'CUSTOMER', description: 'Customer' },
      }));

    // 3. Seed Partners
    // Partner A: Approved, active
    const userPartnerA = await prisma.user.create({
      data: { mobileNumber: MOB_APPROVED_PARTNER_A, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    partnerAUserId = userPartnerA.id;
    await prisma.userRole.create({ data: { userId: partnerAUserId, roleId: partnerRole.id } });
    const pA = await prisma.partnerProfile.create({
      data: {
        userId: partnerAUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Apex Services Pvt Ltd',
        businessName: 'Apex Facility Solutions',
        approvalStatus: 'APPROVED',
      },
    });
    partnerAProfileId = pA.id;

    // Partner B: Approved, active
    const userPartnerB = await prisma.user.create({
      data: { mobileNumber: MOB_APPROVED_PARTNER_B, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    partnerBUserId = userPartnerB.id;
    await prisma.userRole.create({ data: { userId: partnerBUserId, roleId: partnerRole.id } });
    const pB = await prisma.partnerProfile.create({
      data: {
        userId: partnerBUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'BlueSky Maintenance Corp',
        businessName: 'BlueSky Technicians',
        approvalStatus: 'APPROVED',
      },
    });
    partnerBProfileId = pB.id;

    // Pending Partner
    const userPendingPartner = await prisma.user.create({
      data: { mobileNumber: MOB_PENDING_PARTNER, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    pendingPartnerUserId = userPendingPartner.id;
    await prisma.userRole.create({ data: { userId: pendingPartnerUserId, roleId: partnerRole.id } });
    await prisma.partnerProfile.create({
      data: {
        userId: pendingPartnerUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Pending Handyman Services',
        businessName: 'Pending Partner',
        approvalStatus: 'PENDING',
      },
    });

    // Suspended/Blocked Partner
    const userSuspendedPartner = await prisma.user.create({
      data: { mobileNumber: MOB_SUSPENDED_PARTNER, isMobileVerified: true, accountStatus: 'BLOCKED' },
    });
    suspendedPartnerUserId = userSuspendedPartner.id;
    await prisma.userRole.create({ data: { userId: suspendedPartnerUserId, roleId: partnerRole.id } });
    await prisma.partnerProfile.create({
      data: {
        userId: suspendedPartnerUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Suspended Partner Ops',
        businessName: 'Suspended Ops',
        approvalStatus: 'APPROVED', // Profile approved, but user account status is SUSPENDED
      },
    });

    // 4. Seed Workers
    // Worker 1: Active, APPROVED profile
    const userWorker1 = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_1, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    worker1UserId = userWorker1.id;
    await prisma.userRole.create({ data: { userId: worker1UserId, roleId: customerRole.id } });
    await prisma.userRole.create({ data: { userId: worker1UserId, roleId: workerRole.id } });
    const w1 = await prisma.workerProfile.create({
      data: {
        userId: worker1UserId,
        firstName: 'Aakash',
        lastName: 'Sharma',
        workerType: 'TECHNICIAN',
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });
    worker1ProfileId = w1.id;

    // Worker 2: Active, APPROVED profile
    const userWorker2 = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_2, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    worker2UserId = userWorker2.id;
    await prisma.userRole.create({ data: { userId: worker2UserId, roleId: workerRole.id } });
    const w2 = await prisma.workerProfile.create({
      data: {
        userId: worker2UserId,
        firstName: 'Rohan',
        lastName: 'Verma',
        workerType: 'HELPER',
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });
    worker2ProfileId = w2.id;

    // Worker 3: Active, APPROVED profile (for rejection tests)
    const userWorker3 = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_3, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    worker3UserId = userWorker3.id;
    await prisma.userRole.create({ data: { userId: worker3UserId, roleId: workerRole.id } });
    const w3 = await prisma.workerProfile.create({
      data: {
        userId: worker3UserId,
        firstName: 'Vikram',
        lastName: 'Singh',
        workerType: 'HELPER',
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });
    worker3ProfileId = w3.id;

    // Worker 4: Active, APPROVED profile (for expiry tests)
    const userWorker4 = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_4, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    worker4UserId = userWorker4.id;
    await prisma.userRole.create({ data: { userId: worker4UserId, roleId: workerRole.id } });
    const w4 = await prisma.workerProfile.create({
      data: {
        userId: worker4UserId,
        firstName: 'Deepak',
        lastName: 'Kumar',
        workerType: 'HELPER',
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });
    worker4ProfileId = w4.id;

    // Worker with No Profile
    const userNoProfile = await prisma.user.create({
      data: { mobileNumber: MOB_WORKER_NO_PROFILE, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    workerNoProfileUserId = userNoProfile.id;
    await prisma.userRole.create({ data: { userId: workerNoProfileUserId, roleId: customerRole.id } });
  });

  afterAll(async () => {
    const testMobiles = [
      MOB_APPROVED_PARTNER_A,
      MOB_APPROVED_PARTNER_B,
      MOB_PENDING_PARTNER,
      MOB_SUSPENDED_PARTNER,
      MOB_WORKER_1,
      MOB_WORKER_2,
      MOB_WORKER_3,
      MOB_WORKER_4,
      MOB_WORKER_NO_PROFILE,
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
  // 1. Worker Invitation Creation & Validation Rules
  // ============================================================================
  describe('1. Worker Invitation Creation & Validation Rules', () => {
    it('should reject invitation creation from a non-partner user', async () => {
      await expect(
        invitationService.createInvitation(worker1UserId, {
          invitedMobile: MOB_WORKER_2,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject invitation creation from an unapproved partner', async () => {
      await expect(
        invitationService.createInvitation(pendingPartnerUserId, {
          invitedMobile: MOB_WORKER_1,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject invitation creation from a suspended partner account', async () => {
      await expect(
        invitationService.createInvitation(suspendedPartnerUserId, {
          invitedMobile: MOB_WORKER_1,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject invitation with invalid Indian mobile number format', async () => {
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

    it('should normalize 10-digit mobile number and create invitation securely', async () => {
      const rawMobile10Digit = '9911000011'; // MOB_WORKER_1 without +91
      const result = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: rawMobile10Digit,
        workerName: 'Aakash Worker',
        notes: 'Invitation to join Apex team',
      });

      expect(result).toBeDefined();
      expect(result.rawToken).toBeDefined();
      expect(typeof result.rawToken).toBe('string');
      expect(result.rawToken.length).toBe(64); // 32 bytes hex

      expect(result.invitation.invitedMobile).toBe(MOB_WORKER_1);
      expect(result.invitation.invitationStatus).toBe('PENDING');
      expect(result.invitation.partnerId).toBe(partnerAProfileId.toString());
      expect(result.invitation.resendCount).toBe(0);

      // Verify DB record: raw token must NOT be in DB, only SHA-256 hash
      const dbRecord = await prisma.workerInvitation.findUnique({
        where: { id: BigInt(result.invitation.id) },
      });
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.invitationTokenHash).toBeDefined();
      expect(dbRecord?.invitationTokenHash).not.toBe(result.rawToken);

      // Verify expiration is set to end of Kolkata calendar day 7 days from now
      const now = new Date();
      const expectedEnd = DateUtil.getEndOfKolkataDay(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
      expect(new Date(result.invitation.expiresAt).getTime()).toBe(expectedEnd.getTime());
    });

    it('should allow multiple partners to independently invite the same mobile number', async () => {
      // Partner B also invites MOB_WORKER_1
      const resultB = await invitationService.createInvitation(partnerBUserId, {
        invitedMobile: MOB_WORKER_1,
        workerName: 'Aakash Worker',
        notes: 'BlueSky technician offer',
      });

      expect(resultB).toBeDefined();
      expect(resultB.invitation.partnerId).toBe(partnerBProfileId.toString());
      expect(resultB.invitation.invitedMobile).toBe(MOB_WORKER_1);
      expect(resultB.invitation.invitationStatus).toBe('PENDING');

      // Both invitations exist simultaneously
      const pendingCount = await prisma.workerInvitation.count({
        where: {
          invitedMobile: MOB_WORKER_1,
          invitationStatus: 'PENDING',
        },
      });
      expect(pendingCount).toBe(2);
    });

    it('should prevent duplicate pending invitations for the same partner and mobile number', async () => {
      // Partner A attempts to invite MOB_WORKER_1 again while first is still pending
      await expect(
        invitationService.createInvitation(partnerAUserId, {
          invitedMobile: MOB_WORKER_1,
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  // ============================================================================
  // 2. Listing & Details
  // ============================================================================
  describe('2. Listing & Details', () => {
    it('should list partner invitations with pagination and filter', async () => {
      const result = await invitationService.listPartnerInvitations(partnerAUserId, {
        status: 'PENDING',
        limit: 10,
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items[0].partnerId).toBe(partnerAProfileId.toString());
      expect(result.items[0].invitedMobile).toBe(MOB_WORKER_1);

      // Ensure tokens are NOT exposed in listing
      expect((result.items[0] as any).rawToken).toBeUndefined();
      expect((result.items[0] as any).invitationTokenHash).toBeUndefined();
    });

    it('should list worker invitations targeting their mobile number', async () => {
      const invitations = await invitationService.listWorkerInvitations(worker1UserId);

      expect(invitations.items.length).toBe(2); // One from Partner A, one from Partner B
      const partnerIds = invitations.items.map((i) => i.partnerId);
      expect(partnerIds).toContain(partnerAProfileId.toString());
      expect(partnerIds).toContain(partnerBProfileId.toString());
    });

    it('should get invitation details when worker mobile matches', async () => {
      const invitations = await invitationService.listWorkerInvitations(worker1UserId);
      const target = invitations.items[0];

      const details = await invitationService.getInvitationDetails(target.id, worker1UserId);
      expect(details.id).toBe(target.id);
      expect(details.partnerBusinessName).toBeDefined();
    });

    it('should reject getInvitationDetails if authenticated worker mobile does not match', async () => {
      const invitations = await invitationService.listWorkerInvitations(worker1UserId);
      const target = invitations.items[0];

      // Worker 2 tries to inspect Worker 1's invitation
      await expect(
        invitationService.getInvitationDetails(target.id, worker2UserId)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ============================================================================
  // 3. Resend & Revocation Lifecycle
  // ============================================================================
  describe('3. Resend & Revocation Lifecycle', () => {
    let invitationToRevokeId: string;
    let invitationToResendId: string;

    beforeAll(async () => {
      // Create separate invitations for Worker 2
      const invRevoke = await invitationService.createInvitation(partnerBUserId, {
        invitedMobile: MOB_WORKER_2,
        notes: 'To be revoked',
      });
      invitationToRevokeId = invRevoke.invitation.id;

      const invResend = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_2,
        notes: 'To be resent',
      });
      invitationToResendId = invResend.invitation.id;
    });

    it('should allow partner to resend a pending invitation with new token and extended expiry', async () => {
      const resent = await invitationService.resendInvitation(partnerAUserId, invitationToResendId);
      expect(resent).toBeDefined();
      expect(resent.rawToken).toBeDefined();
      expect(resent.invitation.resendCount).toBe(1);
    });

    it('should prevent another partner from resending an invitation they do not own', async () => {
      await expect(
        invitationService.resendInvitation(partnerBUserId, invitationToResendId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow partner to revoke their own pending invitation', async () => {
      const revoked = await invitationService.revokeInvitation(partnerBUserId, invitationToRevokeId);
      expect(revoked.invitationStatus).toBe('REVOKED');
      expect(revoked.revokedAt).toBeDefined();
    });

    it('should prevent revoking an already revoked invitation', async () => {
      await expect(
        invitationService.revokeInvitation(partnerBUserId, invitationToRevokeId)
      ).rejects.toThrow(ConflictError);
    });

    it('should prevent another partner from revoking an invitation they do not own', async () => {
      await expect(
        invitationService.revokeInvitation(partnerBUserId, invitationToResendId)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ============================================================================
  // 4. Worker Acceptance, Prerequisite Enforcement & Multi-Partner Affiliation
  // ============================================================================
  describe('4. Worker Acceptance, Prerequisite Enforcement & Multi-Partner Affiliation', () => {
    let invitationAPartnerA: string;
    let invitationBPartnerB: string;

    beforeAll(async () => {
      const invs = await invitationService.listWorkerInvitations(worker1UserId);
      const invA = invs.items.find((i) => i.partnerId === partnerAProfileId.toString());
      const invB = invs.items.find((i) => i.partnerId === partnerBProfileId.toString());
      invitationAPartnerA = invA!.id;
      invitationBPartnerB = invB!.id;
    });

    it('should reject acceptance if worker has no worker profile registered', async () => {
      // Invite user with no worker profile
      const invNoProfile = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_NO_PROFILE,
      });

      await expect(
        invitationService.acceptInvitation(invNoProfile.invitation.id, workerNoProfileUserId)
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject acceptance if wrong worker attempts to accept invitation', async () => {
      // Worker 2 attempts to accept Worker 1's invitation
      await expect(
        invitationService.acceptInvitation(invitationAPartnerA, worker2UserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should atomically accept invitation and create active affiliation for Partner A', async () => {
      const result = await invitationService.acceptInvitation(invitationAPartnerA, worker1UserId);

      expect(result).toBeDefined();
      expect(result.invitation.invitationStatus).toBe('ACCEPTED');
      expect(result.invitation.respondedAt).toBeDefined();
      expect(result.affiliationId).toBeDefined();
      expect(result.workerProfileId).toBe(worker1ProfileId.toString());

      // Verify affiliation record in DB
      const affiliation = await prisma.workerPartnerAffiliation.findUnique({
        where: { id: BigInt(result.affiliationId) },
      });
      expect(affiliation).toBeDefined();
      expect(affiliation?.affiliationStatus).toBe('ACTIVE');
      expect(affiliation?.workerId).toBe(worker1ProfileId);
      expect(affiliation?.partnerId).toBe(partnerAProfileId);
    });

    it('should prevent replay of already accepted invitation', async () => {
      await expect(
        invitationService.acceptInvitation(invitationAPartnerA, worker1UserId)
      ).rejects.toThrow(ConflictError);
    });

    it('should support non-exclusive multi-partner affiliation: Worker accepts Partner B concurrently', async () => {
      const resultB = await invitationService.acceptInvitation(invitationBPartnerB, worker1UserId);

      expect(resultB).toBeDefined();
      expect(resultB.invitation.invitationStatus).toBe('ACCEPTED');
      expect(resultB.affiliationId).toBeDefined();

      // Verify Worker 1 now has TWO active affiliations simultaneously
      const myAffiliations = await affiliationService.listMyAffiliations(worker1UserId);
      expect(myAffiliations.length).toBe(2);

      const activePartnerIds = myAffiliations.map((a) => a.partnerId);
      expect(activePartnerIds).toContain(partnerAProfileId.toString());
      expect(activePartnerIds).toContain(partnerBProfileId.toString());
    });

    it('should allow worker to get specific affiliation by ID with IDOR protection', async () => {
      const myAffiliations = await affiliationService.listMyAffiliations(worker1UserId);
      const targetAffiliation = myAffiliations[0];

      // Worker 1 can read
      const details = await affiliationService.getMyAffiliation(worker1UserId, targetAffiliation.id);
      expect(details.id).toBe(targetAffiliation.id);

      // Worker 2 cannot read Worker 1's affiliation
      await expect(
        affiliationService.getMyAffiliation(worker2UserId, targetAffiliation.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow partners to view their affiliated workers', async () => {
      const partnerAWorkers = await affiliationService.listPartnerWorkers(partnerAUserId);
      expect(partnerAWorkers.items.length).toBe(1);
      expect(partnerAWorkers.items[0].workerId).toBe(worker1ProfileId.toString());

      const partnerBWorkers = await affiliationService.listPartnerWorkers(partnerBUserId);
      expect(partnerBWorkers.items.length).toBe(1);
      expect(partnerBWorkers.items[0].workerId).toBe(worker1ProfileId.toString());

      // Partner A can get Worker 1 details via affiliation ID
      const details = await affiliationService.getPartnerWorkerDetails(
        partnerAUserId,
        partnerAWorkers.items[0].id
      );
      expect(details.workerId).toBe(worker1ProfileId.toString());
      expect(details.workerType).toBe('TECHNICIAN');

      // Partner A cannot inspect Partner B's affiliation (IDOR protection)
      await expect(
        affiliationService.getPartnerWorkerDetails(partnerAUserId, partnerBWorkers.items[0].id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ============================================================================
  // 5. Worker Rejection & Expired Invitation Rules
  // ============================================================================
  describe('5. Worker Rejection & Expired Invitation Rules', () => {
    let invitationToRejectId: string;
    let invitationToExpireId: string;

    beforeAll(async () => {
      // Send invitation to Worker 3 from Partner A
      const invReject = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_3,
        notes: 'Reject test',
      });
      invitationToRejectId = invReject.invitation.id;

      // Send invitation to Worker 4 from Partner B
      const invExpire = await invitationService.createInvitation(partnerBUserId, {
        invitedMobile: MOB_WORKER_4,
        notes: 'Expiry test',
      });
      invitationToExpireId = invExpire.invitation.id;
    });

    it('should allow worker to reject an invitation with reason', async () => {
      const rejected = await invitationService.rejectInvitation(
        invitationToRejectId,
        worker3UserId,
        'Currently unavailable for new commitments.'
      );

      expect(rejected.invitationStatus).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Currently unavailable for new commitments.');
      expect(rejected.respondedAt).toBeDefined();

      // Cannot accept rejected invitation
      await expect(
        invitationService.acceptInvitation(invitationToRejectId, worker3UserId)
      ).rejects.toThrow(ConflictError);
    });

    it('should reject acceptance of expired invitation and sweep overdue invitations', async () => {
      // Manually backdate expiry to the past
      await prisma.workerInvitation.update({
        where: { id: BigInt(invitationToExpireId) },
        data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      // Sweep expired invitations while it is still PENDING
      const sweptCount = await invitationService.expireInvitations();
      expect(sweptCount).toBeGreaterThanOrEqual(1);

      const dbRecord = await prisma.workerInvitation.findUnique({
        where: { id: BigInt(invitationToExpireId) },
      });
      expect(dbRecord?.invitationStatus).toBe('EXPIRED');

      // Attempting to accept an EXPIRED invitation throws ConflictError
      await expect(
        invitationService.acceptInvitation(invitationToExpireId, worker4UserId)
      ).rejects.toThrow(ConflictError);
    });
  });

  // ============================================================================
  // 6. Affiliation Termination Lifecycle
  // ============================================================================
  describe('6. Affiliation Termination Lifecycle', () => {
    let affiliationAId: string;
    let affiliationBId: string;

    beforeAll(async () => {
      const myAffiliations = await affiliationService.listMyAffiliations(worker1UserId);
      const affA = myAffiliations.find((a) => a.partnerId === partnerAProfileId.toString());
      const affB = myAffiliations.find((a) => a.partnerId === partnerBProfileId.toString());
      affiliationAId = affA!.id;
      affiliationBId = affB!.id;
    });

    it('should allow worker voluntary termination of affiliation with Partner B', async () => {
      const terminated = await affiliationService.terminateMyAffiliation(
        worker1UserId,
        affiliationBId,
        'Stepping down from Partner B projects'
      );

      expect(terminated.affiliationStatus).toBe('TERMINATED');
      expect(terminated.terminatedAt).toBeDefined();
      expect(terminated.terminationReason).toContain('Stepping down');

      // Worker 1 still retains active affiliation with Partner A
      const remainingAffiliations = await affiliationService.listMyAffiliations(worker1UserId);
      expect(remainingAffiliations.length).toBe(1);
      expect(remainingAffiliations[0].partnerId).toBe(partnerAProfileId.toString());
    });

    it('should require mandatory reason when partner terminates an affiliation', async () => {
      await expect(
        affiliationService.terminatePartnerAffiliation(partnerAUserId, affiliationAId, '')
      ).rejects.toThrow(BadRequestError);

      await expect(
        affiliationService.terminatePartnerAffiliation(partnerAUserId, affiliationAId, '   ')
      ).rejects.toThrow(BadRequestError);
    });

    it('should enforce partner IDOR: Partner B cannot terminate Partner A affiliation', async () => {
      await expect(
        affiliationService.terminatePartnerAffiliation(
          partnerBUserId,
          affiliationAId,
          'Unauthorized termination attempt'
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow Partner A to terminate affiliation with mandatory reason', async () => {
      const terminated = await affiliationService.terminatePartnerAffiliation(
        partnerAUserId,
        affiliationAId,
        'Contract period completed successfully.'
      );

      expect(terminated.affiliationStatus).toBe('TERMINATED');
      expect(terminated.terminatedAt).toBeDefined();
      expect(terminated.terminationReason).toBe('Contract period completed successfully.');

      // Active affiliations count is now 0
      const activeAffiliations = await affiliationService.listMyAffiliations(worker1UserId);
      expect(activeAffiliations.length).toBe(0);
    });

    it('should reject termination of already terminated affiliation', async () => {
      await expect(
        affiliationService.terminateMyAffiliation(worker1UserId, affiliationAId)
      ).rejects.toThrow(ConflictError);

      await expect(
        affiliationService.terminatePartnerAffiliation(
          partnerAUserId,
          affiliationAId,
          'Already terminated'
        )
      ).rejects.toThrow(ConflictError);
    });

    it('should preserve full affiliation history and allow re-affiliation', async () => {
      // Historical listing returns terminated records
      const history = await affiliationService.getAffiliationHistory(worker1UserId);
      expect(history.items.length).toBe(2);
      expect(history.items.every((a) => a.affiliationStatus === 'TERMINATED')).toBe(true);

      // Re-invitation after termination works cleanly
      const newInv = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_WORKER_1,
        notes: 'Welcome back invitation',
      });
      expect(newInv.invitation.invitationStatus).toBe('PENDING');

      // Worker 1 accepts again
      const acceptResult = await invitationService.acceptInvitation(newInv.invitation.id, worker1UserId);
      expect(acceptResult.invitation.invitationStatus).toBe('ACCEPTED');

      // Now 1 active affiliation again
      const activeAgain = await affiliationService.listMyAffiliations(worker1UserId);
      expect(activeAgain.length).toBe(1);
      expect(activeAgain[0].partnerId).toBe(partnerAProfileId.toString());
    });
  });
});
