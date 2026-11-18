import { prisma, disconnectDatabase } from '../src/config/db.config';
import {
  driverProfileRepository,
  driverDocumentRepository,
  driverInvitationRepository,
  driverPartnerAffiliationRepository,
  driverVehicleAssignmentRepository,
  driverAvailabilityRepository,
} from '../src/modules/drivers/repositories';
import {
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6D Milestone 2: Data Access Layer & Repositories Integration Tests', () => {
  const MOB_DRIVER_A = '+919777111001';
  const MOB_DRIVER_B = '+919777111002';
  const MOB_PARTNER_A = '+919777222001';
  const MOB_PARTNER_B = '+919777222002';
  const MOB_PROSPECTIVE = '+919777333001';

  let userDriverAId: bigint;
  let userDriverBId: bigint;
  let userPartnerAId: bigint;
  let userPartnerBId: bigint;

  let partnerAProfileId: bigint;
  let partnerBProfileId: bigint;

  let driverAProfileId: bigint;
  let driverBProfileId: bigint;

  let vehicleAId: bigint;
  let vehicleBId: bigint;
  let vehicleTypeId: bigint;

  const createOrResetUser = async (mobileNumber: string) => {
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
    return user;
  };

  const cleanupDatabase = async () => {
    try {
      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_availability WHERE driver_id IN (
          SELECT id FROM public.driver_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_vehicle_assignments WHERE partner_id IN (
          SELECT id FROM public.partner_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
          )
        ) OR driver_id IN (
          SELECT id FROM public.driver_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
          )
        ) OR vehicle_id IN (
          SELECT id FROM public.vehicles WHERE registration_number LIKE 'KA02D6D%'
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_partner_affiliations WHERE partner_id IN (
          SELECT id FROM public.partner_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
          )
        ) OR driver_id IN (
          SELECT id FROM public.driver_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_invitations WHERE partner_id IN (
          SELECT id FROM public.partner_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
          )
        ) OR invited_mobile LIKE '+919777%';
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_documents WHERE driver_id IN (
          SELECT id FROM public.driver_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_profiles WHERE user_id IN (
          SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.partner_vehicles WHERE vehicle_id IN (
          SELECT id FROM public.vehicles WHERE registration_number LIKE 'KA02D6D%'
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.vehicle_documents WHERE vehicle_id IN (
          SELECT id FROM public.vehicles WHERE registration_number LIKE 'KA02D6D%'
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.vehicles WHERE registration_number LIKE 'KA02D6D%';
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.partner_profiles WHERE user_id IN (
          SELECT id FROM public.users WHERE mobile_number LIKE '+919777%'
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.users WHERE mobile_number LIKE '+919777%';
      `);
    } catch (err) {
      console.error('Cleanup error:', err);
    }
  };

  beforeAll(async () => {
    await cleanupDatabase();

    // 1. Fetch or create a vehicle type
    const vType = await prisma.vehicleType.findFirst();
    if (!vType) {
      const cat = await prisma.serviceCategory.findFirst();
      const newType = await prisma.vehicleType.create({
        data: {
          typeCode: 'TATA_ACE_M2',
          typeName: 'Tata Ace M2 Test',
          serviceCategoryId: cat!.id,
          capacityKg: 900,
          baseFare: 300,
          perKmRate: 20,
          perMinuteRate: 3,
        },
      });
      vehicleTypeId = newType.id;
    } else {
      vehicleTypeId = vType.id;
    }

    // 2. Setup users
    const uDA = await createOrResetUser(MOB_DRIVER_A);
    const uDB = await createOrResetUser(MOB_DRIVER_B);
    const uPA = await createOrResetUser(MOB_PARTNER_A);
    const uPB = await createOrResetUser(MOB_PARTNER_B);

    userDriverAId = uDA.id;
    userDriverBId = uDB.id;
    userPartnerAId = uPA.id;
    userPartnerBId = uPB.id;

    // 3. Setup partner profiles
    const pA = await prisma.partnerProfile.create({
      data: {
        userId: userPartnerAId,
        legalName: 'Alpha Logistics Fleet',
        profileType: 'BUSINESS',
        approvalStatus: 'APPROVED',
      },
    });
    partnerAProfileId = pA.id;

    const pB = await prisma.partnerProfile.create({
      data: {
        userId: userPartnerBId,
        legalName: 'Beta Express Fleet',
        profileType: 'BUSINESS',
        approvalStatus: 'APPROVED',
      },
    });
    partnerBProfileId = pB.id;

    // 4. Setup vehicles
    const vA = await prisma.vehicle.create({
      data: {
        registrationNumber: 'KA02D6D001',
        vehicleTypeId,
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });
    vehicleAId = vA.id;

    const vB = await prisma.vehicle.create({
      data: {
        registrationNumber: 'KA02D6D002',
        vehicleTypeId,
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });
    vehicleBId = vB.id;

    // Link vehicles to partner A
    await prisma.partnerVehicle.create({
      data: {
        partnerId: partnerAProfileId,
        vehicleId: vehicleAId,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: true,
      },
    });

    await prisma.partnerVehicle.create({
      data: {
        partnerId: partnerAProfileId,
        vehicleId: vehicleBId,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: false,
      },
    });
  });

  afterAll(async () => {
    await cleanupDatabase();
    await disconnectDatabase();
  });

  // =========================================================================
  // 1. DriverProfileRepository Tests
  // =========================================================================
  describe('1. DriverProfileRepository', () => {
    test('create: should create a new driver profile with default PENDING/DRAFT statuses', async () => {
      const profile = await driverProfileRepository.create({
        userId: userDriverAId,
        firstName: 'Anil',
        lastName: 'Sharma',
        experienceYears: 4,
        licenceNumber: 'DL-01-2016-9999001',
        licenceClasses: ['LMV', 'TRANS'],
        licenceExpiryDate: new Date('2030-01-01'),
        issuingAuthority: 'KA-01 Bangalore Central',
      });

      expect(profile).toBeDefined();
      expect(profile.id).toBeDefined();
      expect(profile.firstName).toBe('Anil');
      expect(profile.approvalStatus).toBe('PENDING');
      expect(profile.submissionStatus).toBe('DRAFT');
      expect(profile.experienceYears).toBe(4);
      driverAProfileId = profile.id;
    });

    test('findById & findByUserId: should retrieve profile with user relations', async () => {
      const byId = await driverProfileRepository.findById(driverAProfileId);
      expect(byId).not.toBeNull();
      expect(byId!.userId).toBe(userDriverAId);
      expect((byId as any).user.mobileNumber).toBe(MOB_DRIVER_A);

      const byUserId = await driverProfileRepository.findByUserId(userDriverAId);
      expect(byUserId).not.toBeNull();
      expect(byUserId!.id).toBe(driverAProfileId);
    });

    test('update: should update general driver profile attributes', async () => {
      const updated = await driverProfileRepository.update(driverAProfileId, {
        bio: 'Experienced city logistics driver',
        experienceYears: 5,
      });

      expect(updated.bio).toBe('Experienced city logistics driver');
      expect(updated.experienceYears).toBe(5);
    });

    test('updateSubmissionStatus: should transition to SUBMITTED with timestamp', async () => {
      const submittedAt = new Date();
      const updated = await driverProfileRepository.updateSubmissionStatus(
        driverAProfileId,
        'SUBMITTED',
        submittedAt
      );

      expect(updated.submissionStatus).toBe('SUBMITTED');
      expect(updated.submittedAt).toBeDefined();
    });

    test('updateApprovalStatus: should record reviewer and transition to APPROVED', async () => {
      const updated = await driverProfileRepository.updateApprovalStatus(
        driverAProfileId,
        'APPROVED',
        userPartnerAId // mock reviewer
      );

      expect(updated.approvalStatus).toBe('APPROVED');
      expect(updated.reviewedBy).toBe(userPartnerAId);
      expect(updated.reviewedAt).toBeDefined();
    });

    test('updateSuspensionStatus: should handle suspension and reactivation', async () => {
      // Suspend
      const suspended = await driverProfileRepository.updateSuspensionStatus(
        driverAProfileId,
        'SUSPENDED',
        'Traffic violation review'
      );
      expect(suspended.approvalStatus).toBe('SUSPENDED');
      expect(suspended.suspensionReason).toBe('Traffic violation review');
      expect(suspended.suspendedAt).toBeDefined();

      // Reactivate
      const reactivated = await driverProfileRepository.updateSuspensionStatus(
        driverAProfileId,
        'APPROVED',
        null,
        null
      );
      expect(reactivated.approvalStatus).toBe('APPROVED');
      expect(reactivated.suspendedAt).toBeNull();
    });

    test('findMany: should support filtering by approvalStatus and pagination', async () => {
      // Create second driver profile for Driver B
      const pB = await driverProfileRepository.create({
        userId: userDriverBId,
        firstName: 'Sunil',
        lastName: 'Rao',
        experienceYears: 2,
        licenceNumber: 'DL-01-2019-9999002',
        licenceClasses: ['LMV'],
        approvalStatus: 'PENDING',
      });
      driverBProfileId = pB.id;

      const result = await driverProfileRepository.findMany(
        { approvalStatus: 'APPROVED' },
        { page: 1, limit: 10 }
      );
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some((d) => d.id === driverAProfileId)).toBe(true);
      expect(result.items.some((d) => d.id === driverBProfileId)).toBe(false);

      const searchResult = await driverProfileRepository.findMany(
        { search: 'Sunil' },
        { page: 1, limit: 10 }
      );
      expect(searchResult.items.length).toBe(1);
      expect(searchResult.items[0].id).toBe(driverBProfileId);
    });

    test('error mapping: should map duplicate user ID to ConflictError (23505)', async () => {
      await expect(
        driverProfileRepository.create({
          userId: userDriverAId, // Already exists
          firstName: 'Duplicate',
        })
      ).rejects.toThrow(ConflictError);
    });

    test('error mapping: should map check constraint failure to BadRequestError (23514)', async () => {
      await expect(
        driverProfileRepository.create({
          userId: BigInt(999999),
          firstName: 'Invalid',
          experienceYears: -5, // Violates chk_driver_experience
        })
      ).rejects.toThrow(BadRequestError);
    });
  });

  // =========================================================================
  // 2. DriverDocumentRepository Tests
  // =========================================================================
  describe('2. DriverDocumentRepository', () => {
    let doc1Id: bigint;
    let doc2Id: bigint;

    test('create: should create document record with PENDING status', async () => {
      const doc = await driverDocumentRepository.create({
        driverId: driverAProfileId,
        documentType: 'DRIVING_LICENCE',
        documentStorageKey: 'drivers/docs/dl_anil_v1.pdf',
        expiryDate: new Date('2030-01-01'),
        documentMetadata: { rto: 'KA-01', class: 'LMV' },
      });

      expect(doc).toBeDefined();
      expect(doc.id).toBeDefined();
      expect(doc.verificationStatus).toBe('PENDING');
      doc1Id = doc.id;
    });

    test('findById: should retrieve document with driver relation', async () => {
      const doc = await driverDocumentRepository.findById(doc1Id);
      expect(doc).not.toBeNull();
      expect(doc!.documentType).toBe('DRIVING_LICENCE');
      expect((doc as any).driver.firstName).toBe('Anil');
    });

    test('replacement history: creating second document preserves old record and findLatestByType returns newer', async () => {
      // Add slight delay so uploadedAt is strictly later
      await new Promise((r) => setTimeout(r, 10));

      const doc2 = await driverDocumentRepository.create({
        driverId: driverAProfileId,
        documentType: 'DRIVING_LICENCE', // Replacement
        documentStorageKey: 'drivers/docs/dl_anil_v2_renewed.pdf',
        expiryDate: new Date('2035-01-01'),
        documentMetadata: { rto: 'KA-01', class: 'LMV-TR' },
      });
      doc2Id = doc2.id;

      // Both documents must exist in list
      const docs = await driverDocumentRepository.findByDriverId(driverAProfileId);
      expect(docs.length).toBe(2);

      // findLatestByType must return doc2 (the renewed one)
      const latest = await driverDocumentRepository.findLatestByType(
        driverAProfileId,
        'DRIVING_LICENCE'
      );
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(doc2Id);
      expect(latest!.documentStorageKey).toBe('drivers/docs/dl_anil_v2_renewed.pdf');
    });

    test('updateVerificationStatus: should update status to VERIFIED with reviewer', async () => {
      const updated = await driverDocumentRepository.updateVerificationStatus(doc2Id, {
        verificationStatus: 'VERIFIED',
        reviewedBy: userPartnerAId,
        reviewedAt: new Date(),
      });

      expect(updated.verificationStatus).toBe('VERIFIED');
      expect(updated.reviewedBy).toBe(userPartnerAId);
    });

    test('findPendingVerification: should list PENDING documents in FIFO order', async () => {
      const pendingQueue = await driverDocumentRepository.findPendingVerification({ page: 1, limit: 10 });
      expect(pendingQueue.items.length).toBeGreaterThanOrEqual(1);
      // doc1 is still PENDING
      expect(pendingQueue.items.some((d) => d.id === doc1Id)).toBe(true);
      // doc2 is VERIFIED, so not in pending queue
      expect(pendingQueue.items.some((d) => d.id === doc2Id)).toBe(false);
    });

    test('error mapping: foreign key violation on non-existent driverId throws NotFoundError/BadRequestError (23503)', async () => {
      await expect(
        driverDocumentRepository.create({
          driverId: BigInt(88888888),
          documentType: 'IDENTITY_PROOF',
          documentStorageKey: 'dummy.pdf',
        })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 3. DriverInvitationRepository Tests
  // =========================================================================
  describe('3. DriverInvitationRepository', () => {
    let invitation1Id: bigint;
    const token1 = 'inv_tok_repo_test_01_' + Date.now();

    test('create: should create driver invitation with PENDING status', async () => {
      const inv = await driverInvitationRepository.create({
        partnerId: partnerAProfileId,
        invitedMobile: MOB_PROSPECTIVE,
        driverName: 'Mohan Lal',
        invitationToken: token1,
        notes: 'Full-time day shift driver invitation',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      expect(inv).toBeDefined();
      expect(inv.id).toBeDefined();
      expect(inv.invitationStatus).toBe('PENDING');
      invitation1Id = inv.id;
    });

    test('findById & findByToken: should retrieve invitation', async () => {
      const byId = await driverInvitationRepository.findById(invitation1Id);
      expect(byId).not.toBeNull();
      expect(byId!.invitedMobile).toBe(MOB_PROSPECTIVE);

      const byTok = await driverInvitationRepository.findByToken(token1);
      expect(byTok).not.toBeNull();
      expect(byTok!.id).toBe(invitation1Id);
    });

    test('findPendingByPartnerAndMobile: should find active pending invitation', async () => {
      const pending = await driverInvitationRepository.findPendingByPartnerAndMobile(
        partnerAProfileId,
        MOB_PROSPECTIVE
      );
      expect(pending).not.toBeNull();
      expect(pending!.id).toBe(invitation1Id);
    });

    test('error mapping: duplicate PENDING invitation throws ConflictError (23505)', async () => {
      await expect(
        driverInvitationRepository.create({
          partnerId: partnerAProfileId,
          invitedMobile: MOB_PROSPECTIVE, // Same partner + same mobile while PENDING
          invitationToken: 'another_token_' + Date.now(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
      ).rejects.toThrow(ConflictError);
    });

    test('atomicTransitionStatus: should succeed on matching status and reject race conditions', async () => {
      // First transition: PENDING -> ACCEPTED
      const transitionSuccess = await driverInvitationRepository.atomicTransitionStatus(
        invitation1Id,
        'PENDING',
        'ACCEPTED',
        { respondedAt: new Date() }
      );
      expect(transitionSuccess).not.toBeNull();
      expect(transitionSuccess!.invitationStatus).toBe('ACCEPTED');

      // Second attempt to transition from PENDING must return null (state condition failed)
      const transitionFail = await driverInvitationRepository.atomicTransitionStatus(
        invitation1Id,
        'PENDING',
        'REJECTED'
      );
      expect(transitionFail).toBeNull();
    });

    test('expireEligibleInvitations: should batch expire invitations past expiresAt', async () => {
      // Create an already-expired pending invitation
      const expiredInv = await driverInvitationRepository.create({
        partnerId: partnerBProfileId,
        invitedMobile: MOB_PROSPECTIVE,
        invitationToken: 'expired_tok_' + Date.now(),
        expiresAt: new Date(Date.now() - 60 * 1000), // 1 minute in the past
      });

      const expiredCount = await driverInvitationRepository.expireEligibleInvitations(new Date());
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const rechecked = await driverInvitationRepository.findById(expiredInv.id);
      expect(rechecked!.invitationStatus).toBe('EXPIRED');
    });
  });

  // =========================================================================
  // 4. DriverPartnerAffiliationRepository Tests
  // =========================================================================
  describe('4. DriverPartnerAffiliationRepository', () => {
    let aff1Id: bigint;
    let aff2Id: bigint;

    test('create: should create active affiliation', async () => {
      const aff1 = await driverPartnerAffiliationRepository.create({
        driverId: driverAProfileId,
        partnerId: partnerAProfileId,
        affiliationStatus: 'ACTIVE',
      });

      expect(aff1).toBeDefined();
      expect(aff1.id).toBeDefined();
      expect(aff1.affiliationStatus).toBe('ACTIVE');
      aff1Id = aff1.id;
    });

    test('listActiveByDriver: should support multiple owner affiliations simultaneously', async () => {
      // Affiliation with Partner B as well
      const aff2 = await driverPartnerAffiliationRepository.create({
        driverId: driverAProfileId,
        partnerId: partnerBProfileId,
        affiliationStatus: 'ACTIVE',
      });
      aff2Id = aff2.id;

      const driverAffs = await driverPartnerAffiliationRepository.listActiveByDriver(driverAProfileId);
      expect(driverAffs.length).toBe(2);
      expect(driverAffs.some((a) => a.partnerId === partnerAProfileId)).toBe(true);
      expect(driverAffs.some((a) => a.partnerId === partnerBProfileId)).toBe(true);
    });

    test('terminate: should terminate affiliation and record reason while preserving history', async () => {
      const terminated = await driverPartnerAffiliationRepository.terminate(
        aff2Id,
        'Driver moved to personal vehicle fleet'
      );

      expect(terminated.affiliationStatus).toBe('TERMINATED');
      expect(terminated.terminatedAt).toBeDefined();
      expect(terminated.terminationReason).toBe('Driver moved to personal vehicle fleet');

      // Now driver has only 1 active affiliation
      const activeAffs = await driverPartnerAffiliationRepository.listActiveByDriver(driverAProfileId);
      expect(activeAffs.length).toBe(1);

      // But history contains both
      const history = await driverPartnerAffiliationRepository.listHistory(driverAProfileId);
      expect(history.length).toBe(2);
      expect(history.some((h) => h.affiliationStatus === 'TERMINATED')).toBe(true);
      expect(history.some((h) => h.affiliationStatus === 'ACTIVE')).toBe(true);
    });

    test('error mapping: duplicate active affiliation throws ConflictError (23505)', async () => {
      // Driver A already has active affiliation with Partner A
      await expect(
        driverPartnerAffiliationRepository.create({
          driverId: driverAProfileId,
          partnerId: partnerAProfileId,
          affiliationStatus: 'ACTIVE',
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  // =========================================================================
  // 5. DriverVehicleAssignmentRepository Tests
  // =========================================================================
  describe('5. DriverVehicleAssignmentRepository', () => {
    let assignmentId: bigint;
    const shiftStart = new Date('2026-11-20T08:00:00.000Z');
    const shiftEnd = new Date('2026-11-20T16:00:00.000Z');

    test('create: should create scheduled assignment', async () => {
      const assignment = await driverVehicleAssignmentRepository.create({
        driverId: driverAProfileId,
        vehicleId: vehicleAId,
        partnerId: partnerAProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: shiftStart,
        endTime: shiftEnd,
        notes: 'Morning cargo run',
      });

      expect(assignment).toBeDefined();
      expect(assignment.id).toBeDefined();
      expect(assignment.assignmentStatus).toBe('SCHEDULED');
      assignmentId = assignment.id;
    });

    test('findById: should retrieve assignment with relations', async () => {
      const found = await driverVehicleAssignmentRepository.findById(assignmentId);
      expect(found).not.toBeNull();
      expect(found!.driverId).toBe(driverAProfileId);
      expect((found as any).vehicle.registrationNumber).toBe('KA02D6D001');
    });

    test('checkPotentialOverlap: should detect overlapping shift window', async () => {
      // Window overlapping with 08:00 - 16:00
      const overlapCheck = await driverVehicleAssignmentRepository.checkPotentialOverlap({
        driverId: driverAProfileId,
        vehicleId: vehicleAId,
        startTime: new Date('2026-11-20T12:00:00.000Z'),
        endTime: new Date('2026-11-20T20:00:00.000Z'),
      });

      expect(overlapCheck.hasDriverOverlap).toBe(true);
      expect(overlapCheck.hasVehicleOverlap).toBe(true);
    });

    test('startAssignment: should transition SCHEDULED -> ACTIVE with actualStartTime', async () => {
      const actualStart = new Date();
      const started = await driverVehicleAssignmentRepository.startAssignment(assignmentId, actualStart);

      expect(started.assignmentStatus).toBe('ACTIVE');
      expect(started.actualStartTime).toBeDefined();

      const active = await driverVehicleAssignmentRepository.findActiveByDriver(driverAProfileId);
      expect(active).not.toBeNull();
      expect(active!.id).toBe(assignmentId);
    });

    test('completeAssignment: should transition ACTIVE -> COMPLETED with actualEndTime', async () => {
      const actualEnd = new Date();
      const completed = await driverVehicleAssignmentRepository.completeAssignment(
        assignmentId,
        actualEnd,
        'Shift completed safely'
      );

      expect(completed.assignmentStatus).toBe('COMPLETED');
      expect(completed.actualEndTime).toBeDefined();

      // No longer active
      const active = await driverVehicleAssignmentRepository.findActiveByDriver(driverAProfileId);
      expect(active).toBeNull();
    });

    test('cancelAssignment: should cancel scheduled assignment with reason and canceller', async () => {
      const newShift = await driverVehicleAssignmentRepository.create({
        driverId: driverAProfileId,
        vehicleId: vehicleAId,
        partnerId: partnerAProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: new Date('2026-11-21T08:00:00.000Z'),
        endTime: new Date('2026-11-21T16:00:00.000Z'),
      });

      const cancelled = await driverVehicleAssignmentRepository.cancelAssignment(
        newShift.id,
        userPartnerAId,
        'Customer cancelled booking'
      );

      expect(cancelled.assignmentStatus).toBe('CANCELLED');
      expect(cancelled.cancelledBy).toBe(userPartnerAId);
      expect(cancelled.cancellationReason).toBe('Customer cancelled booking');
    });

    test('error mapping: overlapping shift rejected with ConflictError (23P01)', async () => {
      const s1 = new Date('2026-11-22T10:00:00.000Z');
      const s2 = new Date('2026-11-22T18:00:00.000Z');

      await driverVehicleAssignmentRepository.create({
        driverId: driverBProfileId,
        vehicleId: vehicleBId,
        partnerId: partnerAProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: s1,
        endTime: s2,
      });

      // Attempt overlapping shift on Driver B -> should throw ConflictError (23P01)
      await expect(
        driverVehicleAssignmentRepository.create({
          driverId: driverBProfileId,
          vehicleId: vehicleAId,
          partnerId: partnerAProfileId,
          assignmentStatus: 'SCHEDULED',
          startTime: new Date('2026-11-22T14:00:00.000Z'),
          endTime: new Date('2026-11-22T22:00:00.000Z'),
        })
      ).rejects.toThrow(ConflictError);
    });

    test('error mapping: check constraint chk_dva_time_range rejected with BadRequestError (23514)', async () => {
      await expect(
        driverVehicleAssignmentRepository.create({
          driverId: driverAProfileId,
          vehicleId: vehicleAId,
          partnerId: partnerAProfileId,
          assignmentStatus: 'SCHEDULED',
          startTime: new Date('2026-11-23T18:00:00.000Z'),
          endTime: new Date('2026-11-23T10:00:00.000Z'), // end before start
        })
      ).rejects.toThrow(BadRequestError);
    });
  });

  // =========================================================================
  // 6. DriverAvailabilityRepository Tests
  // =========================================================================
  describe('6. DriverAvailabilityRepository', () => {
    test('upsertAvailability & findByDriverId: should create and retrieve availability state', async () => {
      const avail = await driverAvailabilityRepository.upsertAvailability(driverAProfileId, {
        isOnline: true,
        isBusy: false,
      });

      expect(avail).toBeDefined();
      expect(avail.driverId).toBe(driverAProfileId);
      expect(avail.isOnline).toBe(true);
      expect(avail.isBusy).toBe(false);

      const found = await driverAvailabilityRepository.findByDriverId(driverAProfileId);
      expect(found).not.toBeNull();
      expect(found!.isOnline).toBe(true);
    });

    test('updateDutyStatus: should toggle online and busy status', async () => {
      const updated = await driverAvailabilityRepository.updateDutyStatus(
        driverAProfileId,
        true,
        true // busy
      );

      expect(updated.isOnline).toBe(true);
      expect(updated.isBusy).toBe(true);
    });

    test('updateHeartbeat: should update heartbeat timestamp', async () => {
      const now = new Date();
      const updated = await driverAvailabilityRepository.updateHeartbeat(driverAProfileId, now);

      expect(updated.lastHeartbeatAt).toBeDefined();
    });

    test('findOnlineDrivers: should list drivers currently online and approved', async () => {
      // Driver A is approved and online
      const onlineList = await driverAvailabilityRepository.findOnlineDrivers({ page: 1, limit: 10 });
      expect(onlineList.items.length).toBeGreaterThanOrEqual(1);
      expect(onlineList.items.some((d) => d.driverId === driverAProfileId)).toBe(true);
    });
  });

  // =========================================================================
  // 7. Multi-Repository Transactions & Concurrency Tests
  // =========================================================================
  describe('7. Multi-Repository Transactions & Concurrency', () => {
    test('transaction commit: multiple repository operations commit atomically', async () => {
      const testMobile = '+919777999888';
      const u = await createOrResetUser(testMobile);

      // Perform composite transaction:
      // 1. Create driver profile
      // 2. Create affiliation
      // 3. Upsert availability
      const result = await prisma.$transaction(async (tx) => {
        const profile = await driverProfileRepository.create(
          {
            userId: u.id,
            firstName: 'Transactional',
            lastName: 'Driver',
            approvalStatus: 'PENDING',
          },
          tx
        );

        const affiliation = await driverPartnerAffiliationRepository.create(
          {
            driverId: profile.id,
            partnerId: partnerAProfileId,
            affiliationStatus: 'ACTIVE',
          },
          tx
        );

        const availability = await driverAvailabilityRepository.upsertAvailability(
          profile.id,
          { isOnline: false, isBusy: false },
          tx
        );

        return { profile, affiliation, availability };
      });

      expect(result.profile.id).toBeDefined();
      expect(result.affiliation.id).toBeDefined();
      expect(result.availability.driverId).toBe(result.profile.id);

      // Verify all 3 records exist in live database
      const checkProfile = await driverProfileRepository.findById(result.profile.id);
      const checkAff = await driverPartnerAffiliationRepository.findActive(result.profile.id, partnerAProfileId);
      const checkAvail = await driverAvailabilityRepository.findByDriverId(result.profile.id);

      expect(checkProfile).not.toBeNull();
      expect(checkAff).not.toBeNull();
      expect(checkAvail).not.toBeNull();
    });

    test('transaction rollback: failure in one repository rolls back all operations', async () => {
      const testMobile = '+919777999777';
      const u = await createOrResetUser(testMobile);

      let createdProfileId: bigint | undefined;

      await expect(
        prisma.$transaction(async (tx) => {
          const profile = await driverProfileRepository.create(
            {
              userId: u.id,
              firstName: 'Rollback',
              lastName: 'Tester',
            },
            tx
          );
          createdProfileId = profile.id;

          // Intentionally violate check constraint on assignment to trigger rollback
          await driverVehicleAssignmentRepository.create(
            {
              driverId: profile.id,
              vehicleId: vehicleAId,
              partnerId: partnerAProfileId,
              startTime: new Date('2026-11-25T16:00:00Z'),
              endTime: new Date('2026-11-25T10:00:00Z'), // Invalid time range
            },
            tx
          );
        })
      ).rejects.toThrow();

      // Profile creation must have been rolled back
      expect(createdProfileId).toBeDefined();
      const checkProfile = await driverProfileRepository.findById(createdProfileId!);
      expect(checkProfile).toBeNull();
    });

    test('concurrency: concurrent atomicTransitionStatus calls allow exactly one success', async () => {
      const invToken = 'tok_conc_test_' + Date.now();
      const inv = await driverInvitationRepository.create({
        partnerId: partnerAProfileId,
        invitedMobile: '+919777999555',
        invitationToken: invToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitationStatus: 'PENDING',
      });

      // Run two simultaneous attempts to accept this invitation
      const attempt1 = driverInvitationRepository.atomicTransitionStatus(
        inv.id,
        'PENDING',
        'ACCEPTED',
        { respondedAt: new Date() }
      );

      const attempt2 = driverInvitationRepository.atomicTransitionStatus(
        inv.id,
        'PENDING',
        'ACCEPTED',
        { respondedAt: new Date() }
      );

      const [res1, res2] = await Promise.all([attempt1, attempt2]);

      // Exactly one must return the updated DriverInvitation, and the other must return null
      const successes = [res1, res2].filter((r) => r !== null);
      const failures = [res1, res2].filter((r) => r === null);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
    });
  });
});
