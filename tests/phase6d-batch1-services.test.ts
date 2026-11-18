import { prisma } from '../src/config/db.config';
import {
  DriverInvitationService,
  driverInvitationService,
} from '../src/modules/drivers/services/driver-invitation.service';
import {
  DriverAffiliationService,
  driverAffiliationService,
} from '../src/modules/drivers/services/driver-affiliation.service';
import {
  DriverAssignmentService,
  driverAssignmentService,
} from '../src/modules/drivers/services/driver-assignment.service';
import {
  DriverProfileRepository,
  DriverDocumentRepository,
  DriverInvitationRepository,
  DriverPartnerAffiliationRepository,
  DriverVehicleAssignmentRepository,
  DriverAvailabilityRepository,
} from '../src/modules/drivers/repositories';
import { VehicleRepository } from '../src/modules/vehicles/vehicles.repository';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6D Batch 1: Driver Invitations, Affiliations, Assignments & Shift Lifecycle', () => {
  const invitationService = driverInvitationService;
  const affiliationService = driverAffiliationService;
  const assignmentService = driverAssignmentService;

  const profileRepo = new DriverProfileRepository();
  const documentRepo = new DriverDocumentRepository();
  const invitationRepo = new DriverInvitationRepository();
  const affiliationRepo = new DriverPartnerAffiliationRepository();
  const assignmentRepo = new DriverVehicleAssignmentRepository();
  const availabilityRepo = new DriverAvailabilityRepository();
  const vehicleRepo = new VehicleRepository();

  // Test mobile numbers
  const MOB_PARTNER_A = '+919811000001';
  const MOB_PARTNER_B = '+919811000002';
  const MOB_DRIVER_COMMERCIAL = '+919811000003'; // Holds LMV + TRANS
  const MOB_DRIVER_BIKE_ONLY = '+919811000004';   // Holds MCWG only
  const MOB_DRIVER_UNONBOARDED = '+919811000005';

  let partnerAUserId: bigint;
  let partnerBUserId: bigint;
  let partnerAId: bigint;
  let partnerBId: bigint;

  let driverCommUserId: bigint;
  let driverCommProfileId: bigint;

  let driverBikeUserId: bigint;
  let driverBikeProfileId: bigint;

  let driverUnonboardedUserId: bigint;

  let vehicleTataAceId: bigint;
  let vehicleBikeId: bigint;
  let vehiclePartnerBId: bigint;

  beforeAll(async () => {
    // 1. Comprehensive Cleanup of Test Records
    const testMobiles = [
      MOB_PARTNER_A,
      MOB_PARTNER_B,
      MOB_DRIVER_COMMERCIAL,
      MOB_DRIVER_BIKE_ONLY,
      MOB_DRIVER_UNONBOARDED,
    ];

    const existingUsers = await prisma.user.findMany({
      where: { mobileNumber: { in: testMobiles } },
      select: { id: true },
    });
    const userIds = existingUsers.map((u) => u.id);

    if (userIds.length > 0) {
      // Delete assignments
      await prisma.driverVehicleAssignment.deleteMany({
        where: {
          OR: [
            { driver: { userId: { in: userIds } } },
            { partner: { userId: { in: userIds } } },
          ],
        },
      });

      // Delete availability
      await prisma.driverAvailability.deleteMany({
        where: { driver: { userId: { in: userIds } } },
      });

      // Delete affiliations
      await prisma.driverPartnerAffiliation.deleteMany({
        where: {
          OR: [
            { driver: { userId: { in: userIds } } },
            { partner: { userId: { in: userIds } } },
          ],
        },
      });

      // Delete invitations
      await prisma.driverInvitation.deleteMany({
        where: {
          OR: [
            { partner: { userId: { in: userIds } } },
            { invitedMobile: { in: testMobiles } },
          ],
        },
      });

      // Delete driver documents & profiles
      await prisma.driverDocument.deleteMany({
        where: { driver: { userId: { in: userIds } } },
      });
      await prisma.driverProfile.deleteMany({
        where: { userId: { in: userIds } },
      });

      // Delete vehicle documents & partner vehicles
      const partnerProfiles = await prisma.partnerProfile.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      });
      const partnerIds = partnerProfiles.map((p) => p.id);

      if (partnerIds.length > 0) {
        const partnerVehicles = await prisma.partnerVehicle.findMany({
          where: { partnerId: { in: partnerIds } },
          select: { vehicleId: true },
        });
        const vIds = partnerVehicles.map((pv) => pv.vehicleId);

        await prisma.partnerVehicle.deleteMany({
          where: { partnerId: { in: partnerIds } },
        });
        await prisma.vehicleDocument.deleteMany({
          where: { vehicleId: { in: vIds } },
        });
        await prisma.vehicle.deleteMany({
          where: { id: { in: vIds } },
        });
      }

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

    // 2. Roles Setup
    const partnerRole = await prisma.role.findUnique({ where: { roleName: 'PARTNER' } }) ||
      await prisma.role.create({ data: { roleName: 'PARTNER', description: 'Partner' } });
    const driverRole = await prisma.role.findUnique({ where: { roleName: 'DRIVER' } }) ||
      await prisma.role.create({ data: { roleName: 'DRIVER', description: 'Driver' } });
    const customerRole = await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } }) ||
      await prisma.role.create({ data: { roleName: 'CUSTOMER', description: 'Customer' } });

    // 3. Setup Partners
    const userPartnerA = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER_A, isMobileVerified: true },
    });
    partnerAUserId = userPartnerA.id;
    await prisma.userRole.create({ data: { userId: partnerAUserId, roleId: partnerRole.id } });

    const pA = await prisma.partnerProfile.create({
      data: {
        userId: partnerAUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Partner Alpha Fleet',
        businessName: 'Alpha Logistics',
        approvalStatus: 'APPROVED',
      },
    });
    partnerAId = pA.id;

    const userPartnerB = await prisma.user.create({
      data: { mobileNumber: MOB_PARTNER_B, isMobileVerified: true },
    });
    partnerBUserId = userPartnerB.id;
    await prisma.userRole.create({ data: { userId: partnerBUserId, roleId: partnerRole.id } });

    const pB = await prisma.partnerProfile.create({
      data: {
        userId: partnerBUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Partner Beta Fleet',
        businessName: 'Beta Transports',
        approvalStatus: 'APPROVED',
      },
    });
    partnerBId = pB.id;

    // 4. Setup Drivers
    // Driver 1: Commercial (LMV + TRANS)
    const userDriverComm = await prisma.user.create({
      data: { mobileNumber: MOB_DRIVER_COMMERCIAL, isMobileVerified: true },
    });
    driverCommUserId = userDriverComm.id;
    await prisma.userRole.create({ data: { userId: driverCommUserId, roleId: driverRole.id } });
    await prisma.userRole.create({ data: { userId: driverCommUserId, roleId: customerRole.id } });

    const profComm = await profileRepo.create({
      userId: driverCommUserId,
      firstName: 'Vikram',
      lastName: 'Singh',
      licenceNumber: 'DL-MH02-2022-1111',
      licenceClasses: ['LMV', 'TRANS'],
      submissionStatus: 'SUBMITTED',
      approvalStatus: 'APPROVED',
    });
    driverCommProfileId = profComm.id;

    // Upload verified documents for Driver 1
    await documentRepo.create({
      driverId: driverCommProfileId,
      documentType: 'DRIVING_LICENCE',
      documentStorageKey: 'drivers/test/comm_dl.pdf',
      verificationStatus: 'VERIFIED',
      expiryDate: new Date('2032-01-01'),
    });
    await documentRepo.create({
      driverId: driverCommProfileId,
      documentType: 'PROFILE_PHOTO',
      documentStorageKey: 'drivers/test/comm_photo.jpg',
      verificationStatus: 'VERIFIED',
    });
    await documentRepo.create({
      driverId: driverCommProfileId,
      documentType: 'IDENTITY_PROOF',
      documentStorageKey: 'drivers/test/comm_id.pdf',
      verificationStatus: 'VERIFIED',
    });

    // Driver 2: Bike Only (MCWG)
    const userDriverBike = await prisma.user.create({
      data: { mobileNumber: MOB_DRIVER_BIKE_ONLY, isMobileVerified: true },
    });
    driverBikeUserId = userDriverBike.id;
    await prisma.userRole.create({ data: { userId: driverBikeUserId, roleId: driverRole.id } });

    const profBike = await profileRepo.create({
      userId: driverBikeUserId,
      firstName: 'Anil',
      lastName: 'Rao',
      licenceNumber: 'DL-MH03-2023-2222',
      licenceClasses: ['MCWG'],
      submissionStatus: 'SUBMITTED',
      approvalStatus: 'APPROVED',
    });
    driverBikeProfileId = profBike.id;

    await documentRepo.create({
      driverId: driverBikeProfileId,
      documentType: 'DRIVING_LICENCE',
      documentStorageKey: 'drivers/test/bike_dl.pdf',
      verificationStatus: 'VERIFIED',
      expiryDate: new Date('2030-01-01'),
    });
    await documentRepo.create({
      driverId: driverBikeProfileId,
      documentType: 'PROFILE_PHOTO',
      documentStorageKey: 'drivers/test/bike_photo.jpg',
      verificationStatus: 'VERIFIED',
    });

    // Driver 3: Unonboarded user (Customer only)
    const userUnonboarded = await prisma.user.create({
      data: { mobileNumber: MOB_DRIVER_UNONBOARDED, isMobileVerified: true },
    });
    driverUnonboardedUserId = userUnonboarded.id;
    await prisma.userRole.create({ data: { userId: driverUnonboardedUserId, roleId: customerRole.id } });

    // 5. Setup Vehicle Types & Vehicles
    let vtAce = await prisma.vehicleType.findFirst({ where: { typeCode: 'TATA_ACE' } });
    if (!vtAce) {
      let cat = await prisma.serviceCategory.findFirst();
      if (!cat) {
        cat = await prisma.serviceCategory.create({
          data: { categoryCode: 'LOGISTICS_TEST', categoryName: 'Logistics Test' },
        });
      }
      vtAce = await prisma.vehicleType.create({
        data: {
          typeCode: 'TATA_ACE',
          typeName: 'Tata Ace (SCV)',
          serviceCategoryId: cat.id,
          capacityKg: 850.0,
          isActive: true,
        },
      });
    }

    let vtBike = await prisma.vehicleType.findFirst({ where: { typeCode: 'TWO_WHEELER' } });
    if (!vtBike) {
      const cat = await prisma.serviceCategory.findFirst();
      vtBike = await prisma.vehicleType.create({
        data: {
          typeCode: 'TWO_WHEELER',
          typeName: 'Two Wheeler (Bike)',
          serviceCategoryId: cat!.id,
          capacityKg: 30.0,
          isActive: true,
        },
      });
    }

    // Vehicle 1: Tata Ace for Partner A
    const v1 = await prisma.vehicle.create({
      data: {
        vehicleTypeId: vtAce.id,
        registrationNumber: 'MH02AB9001',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });
    vehicleTataAceId = v1.id;
    await prisma.partnerVehicle.create({
      data: {
        partnerId: partnerAId,
        vehicleId: vehicleTataAceId,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: true,
      },
    });

    // Vehicle 2: Two Wheeler for Partner A
    const v2 = await prisma.vehicle.create({
      data: {
        vehicleTypeId: vtBike.id,
        registrationNumber: 'MH02AB9002',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });
    vehicleBikeId = v2.id;
    await prisma.partnerVehicle.create({
      data: {
        partnerId: partnerAId,
        vehicleId: vehicleBikeId,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: false,
      },
    });

    // Vehicle 3: Tata Ace for Partner B
    const v3 = await prisma.vehicle.create({
      data: {
        vehicleTypeId: vtAce.id,
        registrationNumber: 'MH02AB9003',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });
    vehiclePartnerBId = v3.id;
    await prisma.partnerVehicle.create({
      data: {
        partnerId: partnerBId,
        vehicleId: vehiclePartnerBId,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: true,
      },
    });
  });

  afterAll(async () => {
    // Final cleanup of test users and associated cascades
    const testMobiles = [
      MOB_PARTNER_A,
      MOB_PARTNER_B,
      MOB_DRIVER_COMMERCIAL,
      MOB_DRIVER_BIKE_ONLY,
      MOB_DRIVER_UNONBOARDED,
    ];
    const users = await prisma.user.findMany({ where: { mobileNumber: { in: testMobiles } } });
    const userIds = users.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.driverVehicleAssignment.deleteMany({
        where: {
          OR: [
            { driver: { userId: { in: userIds } } },
            { partner: { userId: { in: userIds } } },
          ],
        },
      });
      await prisma.driverAvailability.deleteMany({
        where: { driver: { userId: { in: userIds } } },
      });
      await prisma.driverPartnerAffiliation.deleteMany({
        where: {
          OR: [
            { driver: { userId: { in: userIds } } },
            { partner: { userId: { in: userIds } } },
          ],
        },
      });
      await prisma.driverInvitation.deleteMany({
        where: {
          OR: [
            { partner: { userId: { in: userIds } } },
            { invitedMobile: { in: testMobiles } },
          ],
        },
      });
      await prisma.driverDocument.deleteMany({
        where: { driver: { userId: { in: userIds } } },
      });
      await prisma.driverProfile.deleteMany({
        where: { userId: { in: userIds } },
      });

      const partnerProfiles = await prisma.partnerProfile.findMany({
        where: { userId: { in: userIds } },
      });
      const partnerIds = partnerProfiles.map((p) => p.id);
      if (partnerIds.length > 0) {
        const partnerVehicles = await prisma.partnerVehicle.findMany({
          where: { partnerId: { in: partnerIds } },
        });
        const vIds = partnerVehicles.map((pv) => pv.vehicleId);
        await prisma.partnerVehicle.deleteMany({ where: { partnerId: { in: partnerIds } } });
        await prisma.vehicleDocument.deleteMany({ where: { vehicleId: { in: vIds } } });
        await prisma.vehicle.deleteMany({ where: { id: { in: vIds } } });
      }

      await prisma.partnerProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  // ==========================================================================
  // SECTION 1: Driver Invitation Lifecycle & Security
  // ==========================================================================
  describe('1. Driver Invitation Lifecycle & Security', () => {
    let invitationTokenA: string;
    let invitationIdA: string;

    it('should create an invitation targeting driver mobile with exactly 7-day Asia/Kolkata expiry', async () => {
      const res = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_DRIVER_COMMERCIAL,
        driverName: 'Vikram Singh',
        notes: 'Invitation to join Alpha Fleet',
      });

      expect(res.invitation).toBeDefined();
      expect(res.invitation.invitedMobile).toBe(MOB_DRIVER_COMMERCIAL);
      expect(res.invitation.invitationStatus).toBe('PENDING');
      expect(res.invitation.partnerName).toBe('Alpha Logistics');
      expect(res.invitationToken).toBeDefined();

      invitationTokenA = res.invitationToken;
      invitationIdA = res.invitation.id;

      // Verify 7-day expiry in Asia/Kolkata (approx 7 days from now)
      const expiryDate = new Date(res.invitation.expiresAt);
      const diffDays = Math.round((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(7);
      expect(diffDays).toBeLessThanOrEqual(8);
    });

    it('should REJECT duplicate active pending invitation for the same partner and mobile', async () => {
      await expect(
        invitationService.createInvitation(partnerAUserId, {
          invitedMobile: MOB_DRIVER_COMMERCIAL,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should ALLOW another partner fleet (Partner B) to invite the same driver concurrently', async () => {
      const resB = await invitationService.createInvitation(partnerBUserId, {
        invitedMobile: MOB_DRIVER_COMMERCIAL,
      });

      expect(resB.invitation).toBeDefined();
      expect(resB.invitation.partnerId).toBe(partnerBId.toString());
      expect(resB.invitation.invitationStatus).toBe('PENDING');
    });

    it('should retrieve invitation details by secure token without exposing sensitive credentials', async () => {
      const details = await invitationService.getInvitationByToken(invitationTokenA);

      expect(details).toBeDefined();
      expect(details.id).toBe(invitationIdA);
      expect(details.partnerBusinessName).toBe('Alpha Logistics');
      expect(details.invitationStatus).toBe('PENDING');
      expect((details as any).invitationToken).toBeUndefined();
    });

    it('should REJECT acceptance when authenticated user mobile DOES NOT MATCH invitation target', async () => {
      // Driver Bike Only (+919811000004) attempts to accept invitation sent to Driver Commercial (+919811000003)
      await expect(
        invitationService.acceptInvitation(invitationIdA, driverBikeUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should atomically ACCEPT invitation when authenticated mobile matches, creating active affiliation', async () => {
      const acceptRes = await invitationService.acceptInvitation(invitationIdA, driverCommUserId);

      expect(acceptRes).toBeDefined();
      expect(acceptRes.invitation.invitationStatus).toBe('ACCEPTED');
      expect(acceptRes.affiliationId).toBeDefined();
      expect(acceptRes.driverProfileId).toBe(driverCommProfileId.toString());

      // Verify affiliation created in database
      const affiliation = await affiliationRepo.findActive(driverCommProfileId, partnerAId);
      expect(affiliation).toBeDefined();
      expect(affiliation?.affiliationStatus).toBe('ACTIVE');
    });

    it('should REJECT subsequent acceptance attempt on an already-accepted invitation', async () => {
      await expect(
        invitationService.acceptInvitation(invitationIdA, driverCommUserId)
      ).rejects.toThrow(ConflictError);
    });

    it('should handle unonboarded user accepting invitation: creates profile & assigns DRIVER role while preserving CUSTOMER role', async () => {
      // Invite unonboarded user
      const inviteRes = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_DRIVER_UNONBOARDED,
        driverName: 'Newbie Driver',
      });

      // Accept invitation
      const acceptRes = await invitationService.acceptInvitation(
        inviteRes.invitation.id,
        driverUnonboardedUserId
      );

      expect(acceptRes.affiliationId).toBeDefined();

      // Verify user now has DRIVER role AND preserved CUSTOMER role
      const userRoles = await prisma.userRole.findMany({
        where: { userId: driverUnonboardedUserId },
        include: { role: true },
      });
      const names = userRoles.map((ur) => ur.role.roleName);
      expect(names).toContain('CUSTOMER');
      expect(names).toContain('DRIVER');

      // Profile was created with DRAFT / PENDING (Not auto-approved!)
      const prof = await profileRepo.findByUserId(driverUnonboardedUserId);
      expect(prof).toBeDefined();
      expect(prof?.submissionStatus).toBe('DRAFT');
      expect(prof?.approvalStatus).toBe('PENDING');
    });

    it('should support invitation revocation by the fleet partner owner', async () => {
      const inviteToRevoke = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: '+919811000999',
      });

      const revoked = await invitationService.revokeInvitation(
        partnerAUserId,
        inviteToRevoke.invitation.id,
        'No longer hiring'
      );

      expect(revoked.invitationStatus).toBe('REVOKED');
      expect(revoked.rejectionReason).toBe('No longer hiring');

      // Cannot accept revoked invitation
      const userTemp = await prisma.user.create({
        data: { mobileNumber: '+919811000999', isMobileVerified: true },
      });
      await expect(
        invitationService.acceptInvitation(inviteToRevoke.invitation.id, userTemp.id)
      ).rejects.toThrow(ConflictError);
      await prisma.user.delete({ where: { id: userTemp.id } });
    });
  });

  // ==========================================================================
  // SECTION 2: Multi-Partner Affiliation Lifecycle & Tenant Isolation
  // ==========================================================================
  describe('2. Multi-Partner Affiliation Lifecycle & Tenant Isolation', () => {
    it('should support a single driver having multiple active affiliations concurrently', async () => {
      // Driver Commercial is already affiliated with Partner A.
      // Now Partner B invites Driver Commercial, and Driver Commercial accepts.
      const inviteB = await invitationRepo.findPendingByPartnerAndMobile(
        partnerBId,
        MOB_DRIVER_COMMERCIAL
      );
      expect(inviteB).toBeDefined();

      await invitationService.acceptInvitation(inviteB!.id, driverCommUserId);

      // Check affiliations for Driver Commercial: must be affiliated with BOTH Partner A and Partner B
      const affiliations = await affiliationService.listDriverAffiliations(driverCommUserId);
      const partnerIds = affiliations.map((a) => a.partnerId);

      expect(partnerIds).toContain(partnerAId.toString());
      expect(partnerIds).toContain(partnerBId.toString());
      expect(affiliations.length).toBeGreaterThanOrEqual(2);
    });

    it('should enforce tenant isolation: Partner A cannot view affiliations of Partner B', async () => {
      const partnerAAffiliations = await affiliationService.listPartnerAffiliations(partnerAUserId);
      const partnerIds = partnerAAffiliations.map((a) => a.partnerId);

      expect(partnerIds.every((id) => id === partnerAId.toString())).toBe(true);
      expect(partnerIds).not.toContain(partnerBId.toString());
    });

    it('should prevent unauthorized access to specific affiliation ID by unrelated user', async () => {
      const pAAffiliations = await affiliationService.listPartnerAffiliations(partnerAUserId);
      const affiliationAId = pAAffiliations[0].id;

      // Partner B attempts to inspect Partner A's affiliation
      await expect(
        affiliationService.getAffiliationById(partnerBUserId, affiliationAId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should preserve affiliation history with termination reason and timestamp upon termination', async () => {
      // Partner B terminates affiliation with Driver Commercial
      const pBAffiliations = await affiliationService.listPartnerAffiliations(partnerBUserId);
      const affB = pBAffiliations.find((a) => a.driverId === driverCommProfileId.toString());
      expect(affB).toBeDefined();

      const terminated = await affiliationService.terminateAffiliationByPartner(
        partnerBUserId,
        affB!.id,
        'Seasonal contract concluded'
      );

      expect(terminated.affiliationStatus).toBe('TERMINATED');
      expect(terminated.terminationReason).toBe('Seasonal contract concluded');
      expect(terminated.terminatedAt).toBeDefined();

      // Driver Commercial still has active affiliation with Partner A
      const remainingActive = await affiliationService.listDriverAffiliations(driverCommUserId, {
        status: 'ACTIVE',
      });
      const activePartnerIds = remainingActive.map((a) => a.partnerId);
      expect(activePartnerIds).toContain(partnerAId.toString());
      expect(activePartnerIds).not.toContain(partnerBId.toString());
    });
  });

  // ==========================================================================
  // SECTION 3: Driver Vehicle Assignment Scheduling & Licence Policy
  // ==========================================================================
  describe('3. Assignment Scheduling & Licence Policy Enforcement', () => {
    let nowEpoch: number;
    let shift1Start: Date;
    let shift1End: Date;
    let shift2Start: Date;
    let shift2End: Date;

    beforeAll(async () => {
      await prisma.driverVehicleAssignment.deleteMany({});
      await prisma.driverAvailability.deleteMany({});
      nowEpoch = Date.now();
      // Future non-overlapping shifts
      shift1Start = new Date(nowEpoch + 3 * 60 * 60 * 1000); // 3 hours from now
      shift1End = new Date(nowEpoch + 7 * 60 * 60 * 1000);   // 7 hours from now
      shift2Start = new Date(nowEpoch + 8 * 60 * 60 * 1000); // 8 hours from now
      shift2End = new Date(nowEpoch + 12 * 60 * 60 * 1000);  // 12 hours from now
    });

    afterAll(async () => {
      await prisma.driverVehicleAssignment.deleteMany({});
      await prisma.driverAvailability.deleteMany({});
    });

    it('should REJECT scheduling on a vehicle owned by another partner fleet', async () => {
      // Partner A tries to assign Partner B's vehicle
      await expect(
        assignmentService.scheduleAssignment(partnerAUserId, {
          driverId: driverCommProfileId,
          vehicleId: vehiclePartnerBId,
          startTime: shift1Start,
          endTime: shift1End,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should REJECT scheduling a driver who is NOT affiliated with the partner fleet', async () => {
      // Driver Bike Only is not affiliated with Partner A
      await expect(
        assignmentService.scheduleAssignment(partnerAUserId, {
          driverId: driverBikeProfileId,
          vehicleId: vehicleTataAceId,
          startTime: shift1Start,
          endTime: shift1End,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should REJECT driver on vehicle class when licence endorsement is INCOMPATIBLE', async () => {
      // Affiliate Driver Bike Only (MCWG) with Partner A
      const invite = await invitationService.createInvitation(partnerAUserId, {
        invitedMobile: MOB_DRIVER_BIKE_ONLY,
      });
      await invitationService.acceptInvitation(invite.invitation.id, driverBikeUserId);

      // Attempt to assign Bike-only driver to TATA_ACE (requires LMV/TRANS)
      await expect(
        assignmentService.scheduleAssignment(partnerAUserId, {
          driverId: driverBikeProfileId,
          vehicleId: vehicleTataAceId, // TATA_ACE SCV
          startTime: shift1Start,
          endTime: shift1End,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should SUCCEED scheduling when driver holds appropriate licence endorsement (LMV on Tata Ace)', async () => {
      const assignment = await assignmentService.scheduleAssignment(partnerAUserId, {
        driverId: driverCommProfileId,
        vehicleId: vehicleTataAceId,
        startTime: shift1Start,
        endTime: shift1End,
        notes: 'Morning cargo delivery shift',
      });

      expect(assignment).toBeDefined();
      expect(assignment.assignmentStatus).toBe('SCHEDULED');
      expect(assignment.vehicleTypeCode).toBe('TATA_ACE');
      expect(assignment.notes).toBe('Morning cargo delivery shift');
    });

    it('should ALLOW the same driver to be assigned to a different vehicle in a NON-OVERLAPPING shift', async () => {
      // Driver Commercial takes Bike in shift 2
      const assignment2 = await assignmentService.scheduleAssignment(partnerAUserId, {
        driverId: driverCommProfileId,
        vehicleId: vehicleBikeId,
        startTime: shift2Start,
        endTime: shift2End,
      });

      expect(assignment2).toBeDefined();
      expect(assignment2.assignmentStatus).toBe('SCHEDULED');
      expect(assignment2.vehicleTypeCode).toBe('TWO_WHEELER');
    });

    it('should REJECT overlapping shift for the SAME DRIVER on a different vehicle', async () => {
      // Shift overlapping with shift 1 window [now + 4h, now + 6h]
      const overlappingStart = new Date(nowEpoch + 4 * 60 * 60 * 1000);
      const overlappingEnd = new Date(nowEpoch + 6 * 60 * 60 * 1000);

      await expect(
        assignmentService.scheduleAssignment(partnerAUserId, {
          driverId: driverCommProfileId,
          vehicleId: vehicleBikeId, // Different vehicle, same driver
          startTime: overlappingStart,
          endTime: overlappingEnd,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should REJECT overlapping shift for the SAME VEHICLE with a different driver', async () => {
      // Shift overlapping with shift 1 window on Tata Ace
      const overlappingStart = new Date(nowEpoch + 4 * 60 * 60 * 1000);
      const overlappingEnd = new Date(nowEpoch + 6 * 60 * 60 * 1000);

      // Create another commercial driver
      const extraMobile = `+919811${Math.floor(100000 + Math.random() * 900000)}`;
      const userExtra = await prisma.user.create({
        data: { mobileNumber: extraMobile, isMobileVerified: true },
      });
      const profExtra = await profileRepo.create({
        userId: userExtra.id,
        firstName: 'Extra',
        licenceClasses: ['LMV'],
        submissionStatus: 'SUBMITTED',
        approvalStatus: 'APPROVED',
      });
      await documentRepo.create({
        driverId: profExtra.id,
        documentType: 'DRIVING_LICENCE',
        documentStorageKey: 'drivers/test/extra_dl.pdf',
        verificationStatus: 'VERIFIED',
      });
      await documentRepo.create({
        driverId: profExtra.id,
        documentType: 'PROFILE_PHOTO',
        documentStorageKey: 'drivers/test/extra_photo.jpg',
        verificationStatus: 'VERIFIED',
      });
      await affiliationRepo.create({
        driverId: profExtra.id,
        partnerId: partnerAId,
        affiliationStatus: 'ACTIVE',
      });

      await expect(
        assignmentService.scheduleAssignment(partnerAUserId, {
          driverId: profExtra.id,
          vehicleId: vehicleTataAceId, // Same vehicle as shift 1
          startTime: overlappingStart,
          endTime: overlappingEnd,
        })
      ).rejects.toThrow(ConflictError);

      // Cleanup extra user
      await prisma.driverDocument.deleteMany({ where: { driverId: profExtra.id } });
      await prisma.driverPartnerAffiliation.deleteMany({ where: { driverId: profExtra.id } });
      await prisma.driverProfile.deleteMany({ where: { id: profExtra.id } });
      await prisma.user.delete({ where: { id: userExtra.id } });
    });
  });

  // ==========================================================================
  // SECTION 4: Shift Lifecycle: Start (Option A), Completion & Telemetry
  // ==========================================================================
  describe('4. Shift Lifecycle: Explicit Start (Option A) & Completion', () => {
    let testAssignmentId: string;

    beforeEach(async () => {
      await prisma.driverVehicleAssignment.deleteMany({});
      await prisma.driverAvailability.deleteMany({});
      // Schedule an immediate shift (startTime is 5 minutes from now)
      const startTime = new Date(Date.now() + 5 * 60 * 1000);
      const endTime = new Date(Date.now() + 4 * 60 * 60 * 1000);

      const assignment = await assignmentService.scheduleAssignment(partnerAUserId, {
        driverId: driverCommProfileId,
        vehicleId: vehicleTataAceId,
        startTime,
        endTime,
      });
      testAssignmentId = assignment.id;
    });

    afterEach(async () => {
      await prisma.driverVehicleAssignment.deleteMany({});
      await prisma.driverAvailability.deleteMany({});
    });

    it('should NOT activate shift automatically based on startTime alone (Option A)', async () => {
      const assignment = await assignmentRepo.findById(BigInt(testAssignmentId));
      expect(assignment?.assignmentStatus).toBe('SCHEDULED');
      expect(assignment?.actualStartTime).toBeNull();
    });

    it('should REJECT startAssignment when called by an unauthorized user', async () => {
      // Driver Bike attempts to start Driver Commercial assignment
      await expect(
        assignmentService.startAssignment(testAssignmentId, driverBikeUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should explicitly activate shift when called by assigned driver, updating availability to ON_DUTY', async () => {
      const activeRes = await assignmentService.startAssignment(testAssignmentId, driverCommUserId);

      expect(activeRes.assignmentStatus).toBe('ACTIVE');
      expect(activeRes.actualStartTime).toBeDefined();

      // Verify availability state
      const availability = await availabilityRepo.findByDriverId(driverCommProfileId);
      expect(availability?.isOnline).toBe(true);
      expect(availability?.isBusy).toBe(true);
      expect(availability?.currentAssignmentId?.toString()).toBe(testAssignmentId);
    });

    it('should REJECT starting a second shift while already ON_DUTY in an active shift', async () => {
      // Adjust shift 1 to end at now + 10m so non-overlapping with shift 2 at now + 15m
      await prisma.driverVehicleAssignment.update({
        where: { id: BigInt(testAssignmentId) },
        data: { endTime: new Date(Date.now() + 10 * 60 * 1000) },
      });

      // Start shift 1
      await assignmentService.startAssignment(testAssignmentId, driverCommUserId);

      // Create shift 2 for same driver scheduled after shift 1 (non-overlapping window, within 60m start window)
      const shift2 = await assignmentRepo.create({
        driverId: driverCommProfileId,
        vehicleId: vehicleBikeId,
        partnerId: partnerAId,
        assignmentStatus: 'SCHEDULED',
        startTime: new Date(Date.now() + 15 * 60 * 1000),
        endTime: new Date(Date.now() + 4 * 60 * 60 * 1000),
      });

      // Attempt to activate shift 2 while shift 1 is ACTIVE
      await expect(
        assignmentService.startAssignment(shift2.id, driverCommUserId)
      ).rejects.toThrow(ConflictError);

      await prisma.driverVehicleAssignment.delete({ where: { id: shift2.id } });
    });

    it('should successfully complete an active shift and reset driver availability to available', async () => {
      // Start shift
      await assignmentService.startAssignment(testAssignmentId, driverCommUserId);

      // Complete shift
      const completed = await assignmentService.completeAssignment(
        testAssignmentId,
        driverCommUserId,
        'Shift completed safely, odometer 45200'
      );

      expect(completed.assignmentStatus).toBe('COMPLETED');
      expect(completed.actualEndTime).toBeDefined();
      expect(completed.notes).toContain('odometer 45200');

      // Verify availability state: isBusy is false, currentAssignment is cleared
      const availability = await availabilityRepo.findByDriverId(driverCommProfileId);
      expect(availability?.isOnline).toBe(true);
      expect(availability?.isBusy).toBe(false);
      expect(availability?.currentAssignmentId).toBeNull();
    });

    it('should ensure heartbeats do not reactivate a completed or cancelled assignment', async () => {
      await assignmentService.startAssignment(testAssignmentId, driverCommUserId);
      await assignmentService.completeAssignment(testAssignmentId, driverCommUserId);

      // Driver device sends heartbeat
      const heartbeatRes = await assignmentService.updateHeartbeat(driverCommUserId);

      expect(heartbeatRes.isBusy).toBe(false);
      expect(heartbeatRes.currentAssignmentId).toBeNull();
    });
  });

  // ==========================================================================
  // SECTION 5: Shift Cancellation Rules Matrix
  // ==========================================================================
  describe('5. Shift Cancellation Rules Matrix', () => {
    beforeEach(async () => {
      await prisma.driverVehicleAssignment.deleteMany({});
      await prisma.driverAvailability.deleteMany({});
    });

    afterEach(async () => {
      await prisma.driverVehicleAssignment.deleteMany({});
      await prisma.driverAvailability.deleteMany({});
    });

    it('should ALLOW driver to self-cancel scheduled shift when >= 2 hours remain before start', async () => {
      // Shift starts in 3 hours
      const startTime = new Date(Date.now() + 3 * 60 * 60 * 1000);
      const assignment = await assignmentService.scheduleAssignment(partnerAUserId, {
        driverId: driverCommProfileId,
        vehicleId: vehicleTataAceId,
        startTime,
      });

      const cancelled = await assignmentService.cancelAssignment(
        assignment.id,
        driverCommUserId,
        'DRIVER',
        'Personal emergency'
      );

      expect(cancelled.assignmentStatus).toBe('CANCELLED');
      expect(cancelled.cancellationReason).toBe('Personal emergency');
      expect(cancelled.cancelledBy).toBe(driverCommUserId.toString());
    });

    it('should REJECT driver cancellation when < 2 hours remain before scheduled start (owner approval required)', async () => {
      // Shift starts in 1 hour 15 minutes (< 2 hours)
      const startTime = new Date(Date.now() + 75 * 60 * 1000);
      const assignment = await assignmentRepo.create({
        driverId: driverCommProfileId,
        vehicleId: vehicleTataAceId,
        partnerId: partnerAId,
        assignmentStatus: 'SCHEDULED',
        startTime,
      });

      await expect(
        assignmentService.cancelAssignment(
          assignment.id,
          driverCommUserId,
          'DRIVER',
          'Late cancellation attempt'
        )
      ).rejects.toThrow(ValidationError);

      // Partner fleet owner CAN cancel the scheduled shift inside 2 hours
      const partnerCancelled = await assignmentService.cancelAssignment(
        assignment.id,
        partnerAUserId,
        'PARTNER',
        'Owner approved emergency relief'
      );
      expect(partnerCancelled.assignmentStatus).toBe('CANCELLED');
      expect(partnerCancelled.cancelledBy).toBe(partnerAUserId.toString());
    });

    it('should REJECT driver unilateral cancellation of an ACTIVE shift', async () => {
      const assignment = await assignmentRepo.create({
        driverId: driverCommProfileId,
        vehicleId: vehicleTataAceId,
        partnerId: partnerAId,
        assignmentStatus: 'ACTIVE',
        startTime: new Date(Date.now() - 30 * 60 * 1000),
        actualStartTime: new Date(Date.now() - 30 * 60 * 1000),
      });

      // Driver cannot abandon an active shift unilaterally
      await expect(
        assignmentService.cancelAssignment(
          assignment.id,
          driverCommUserId,
          'DRIVER',
          'Abandoning vehicle'
        )
      ).rejects.toThrow(ValidationError);

      // Partner owner CAN cancel/terminate active shift with cause
      const ownerTerminated = await assignmentService.cancelAssignment(
        assignment.id,
        partnerAUserId,
        'PARTNER',
        'Vehicle technical breakdown relief'
      );
      expect(ownerTerminated.assignmentStatus).toBe('CANCELLED');
      expect(ownerTerminated.actualEndTime).toBeDefined();

      await prisma.driverVehicleAssignment.delete({ where: { id: assignment.id } });
    });
  });

  // ==========================================================================
  // SECTION 6: PostgreSQL Kernel-Level Concurrency Guarantees (23P01)
  // ==========================================================================
  describe('6. PostgreSQL Kernel Concurrency: Simultaneous Overlap Exclusions', () => {
    beforeEach(async () => {
      await prisma.driverVehicleAssignment.deleteMany({});
      await prisma.driverAvailability.deleteMany({});
    });

    afterEach(async () => {
      await prisma.driverVehicleAssignment.deleteMany({});
      await prisma.driverAvailability.deleteMany({});
    });

    it('should permit exactly one and reject the other with 23P01 (ConflictError) under concurrent overlap requests', async () => {
      const shiftStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const shiftEnd = new Date(Date.now() + 28 * 60 * 60 * 1000);

      // Two concurrent scheduleAssignment calls for the same vehicle
      const results = await Promise.allSettled([
        assignmentService.scheduleAssignment(partnerAUserId, {
          driverId: driverCommProfileId,
          vehicleId: vehicleTataAceId,
          startTime: shiftStart,
          endTime: shiftEnd,
        }),
        assignmentService.scheduleAssignment(partnerAUserId, {
          driverId: driverCommProfileId,
          vehicleId: vehicleTataAceId,
          startTime: shiftStart,
          endTime: shiftEnd,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Cleanup
      const createdAssignment = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      await prisma.driverVehicleAssignment.delete({ where: { id: BigInt(createdAssignment.id) } });
    });
  });
});
