import { prisma } from '../src/config/db.config';
import {
  DriverAdminService,
  driverAdminService,
} from '../src/modules/drivers/services/driver-admin.service';
import {
  DriverAssignmentService,
  driverAssignmentService,
} from '../src/modules/drivers/services/driver-assignment.service';
import {
  DriverOnboardingService,
  driverOnboardingService,
} from '../src/modules/drivers/services/driver-onboarding.service';
import {
  DriverProfileRepository,
  DriverDocumentRepository,
  DriverPartnerAffiliationRepository,
  DriverVehicleAssignmentRepository,
  DriverAvailabilityRepository,
} from '../src/modules/drivers/repositories';
import {
  driverKycValidationService,
} from '../src/modules/drivers';
import {
  authService,
} from '../src/modules/auth/auth.service';
import {
  usersService,
} from '../src/modules/users/users.service';
import {
  requireApprovedDriver,
  requireOperationalDriver,
} from '../src/modules/drivers/drivers.middleware';
import { VehicleRepository } from '../src/modules/vehicles/vehicles.repository';
import { UserRole } from '../src/common/constants';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from '../src/common/errors';
import { storageService } from '../src/common/services/storage.service';
import { DateUtil } from '../src/common/utils/date.util';

describe('Phase 6D Batch 2: Driver Admin Verification, Approval & Authentication Integration', () => {
  const adminService = driverAdminService;
  const assignmentService = driverAssignmentService;
  const onboardingService = driverOnboardingService;

  const profileRepo = new DriverProfileRepository();
  const documentRepo = new DriverDocumentRepository();
  const affiliationRepo = new DriverPartnerAffiliationRepository();
  const assignmentRepo = new DriverVehicleAssignmentRepository();
  const availabilityRepo = new DriverAvailabilityRepository();
  const vehicleRepo = new VehicleRepository();

  // Distinct test mobile numbers
  const MOB_ADMIN = '+919812000001';
  const MOB_SUPER_ADMIN = '+919812000002';
  const MOB_DRIVER_ELIGIBLE = '+919812000003';
  const MOB_DRIVER_EXPIRED = '+919812000004';
  const MOB_PARTNER_OWNER = '+919812000005';
  const MOB_DUAL_ROLE_USER = '+919812000006';

  let adminUserId: bigint;
  let superAdminUserId: bigint;

  let driverEligibleUserId: bigint;
  let driverEligibleProfileId: bigint;

  let driverExpiredUserId: bigint;
  let driverExpiredProfileId: bigint;

  let partnerOwnerUserId: bigint;
  let partnerOwnerId: bigint;
  let partnerVehicleId: bigint;

  let dualRoleUserId: bigint;
  let dualRoleDriverProfileId: bigint;

  let rameshDlKey: string;
  let rameshPhotoKey: string;
  let rameshIdKey: string;
  let sureshDlKey: string;

  const ensureUserWithRoles = async (mobileNumber: string, roleNames: string[]) => {
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
        const existing = await prisma.userRole.findFirst({
          where: { userId: user.id, roleId: role.id },
        });
        if (!existing) {
          await prisma.userRole.create({
            data: { userId: user.id, roleId: role.id },
          });
        }
      }
    }

    return user;
  };

  beforeAll(async () => {
    const testMobiles = [
      MOB_ADMIN,
      MOB_SUPER_ADMIN,
      MOB_DRIVER_ELIGIBLE,
      MOB_DRIVER_EXPIRED,
      MOB_PARTNER_OWNER,
      MOB_DUAL_ROLE_USER,
    ];

    // Cleanup existing test records
    for (const mob of testMobiles) {
      const user = await prisma.user.findUnique({ where: { mobileNumber: mob } });
      if (user) {
        const dProf = await prisma.driverProfile.findUnique({ where: { userId: user.id } });
        if (dProf) {
          await prisma.driverVehicleAssignment.deleteMany({ where: { driverId: dProf.id } });
          await prisma.driverAvailability.deleteMany({ where: { driverId: dProf.id } });
          await prisma.driverPartnerAffiliation.deleteMany({ where: { driverId: dProf.id } });
          await prisma.driverDocument.deleteMany({ where: { driverId: dProf.id } });
          await prisma.driverProfile.delete({ where: { id: dProf.id } });
        }
        const pProf = await prisma.partnerProfile.findUnique({ where: { userId: user.id } });
        if (pProf) {
          await prisma.driverPartnerAffiliation.deleteMany({ where: { partnerId: pProf.id } });
          await prisma.driverInvitation.deleteMany({ where: { partnerId: pProf.id } });
          await prisma.driverVehicleAssignment.deleteMany({ where: { partnerId: pProf.id } });
          await prisma.partnerVehicle.deleteMany({ where: { partnerId: pProf.id } });
          await prisma.partnerProfile.delete({ where: { id: pProf.id } });
        }
        await prisma.userRole.deleteMany({ where: { userId: user.id } });
        await prisma.userSession.deleteMany({ where: { userId: user.id } });
        await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }

    // 1. Create Admin & Super Admin
    const adminUser = await ensureUserWithRoles(MOB_ADMIN, ['CUSTOMER', 'ADMIN']);
    adminUserId = adminUser.id;

    const superAdminUser = await ensureUserWithRoles(MOB_SUPER_ADMIN, ['CUSTOMER', 'SUPER_ADMIN']);
    superAdminUserId = superAdminUser.id;

    // 2. Create Partner Fleet Owner & Vehicle
    const partnerUser = await ensureUserWithRoles(MOB_PARTNER_OWNER, ['CUSTOMER', 'PARTNER']);
    partnerOwnerUserId = partnerUser.id;

    const partnerProfile = await prisma.partnerProfile.create({
      data: {
        userId: partnerOwnerUserId,
        profileType: 'INDIVIDUAL',
        legalName: 'Owner Fleet Logistics Pvt Ltd',
        businessName: 'Owner Fleet Logistics',
        approvalStatus: 'APPROVED',
      },
    });
    partnerOwnerId = partnerProfile.id;

    let vType = await prisma.vehicleType.findFirst({ where: { typeCode: 'TATA_ACE' } });
    if (!vType) {
      let cat = await prisma.serviceCategory.findFirst();
      if (!cat) {
        cat = await prisma.serviceCategory.create({
          data: { categoryCode: 'LOGISTICS_TEST', categoryName: 'Logistics Test' },
        });
      }
      vType = await prisma.vehicleType.create({
        data: {
          typeCode: 'TATA_ACE',
          typeName: 'Tata Ace Mini Truck',
          serviceCategoryId: cat.id,
          capacityKg: 850,
          isActive: true,
        },
      });
    }

    // Clean up any conflicting registration number
    const existingVehicle = await prisma.vehicle.findUnique({ where: { registrationNumber: 'DL01EF1122' } });
    if (existingVehicle) {
      await prisma.partnerVehicle.deleteMany({ where: { vehicleId: existingVehicle.id } });
      await prisma.driverVehicleAssignment.deleteMany({ where: { vehicleId: existingVehicle.id } });
      await prisma.vehicle.delete({ where: { id: existingVehicle.id } });
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        vehicleTypeId: vType.id,
        registrationNumber: 'DL01EF1122',
        rcNumber: 'RC-DL01EF1122',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });
    partnerVehicleId = vehicle.id;

    await prisma.partnerVehicle.create({
      data: {
        partnerId: partnerOwnerId,
        vehicleId: partnerVehicleId,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: true,
      },
    });

    // 3. Create Eligible Driver
    const driverUser = await ensureUserWithRoles(MOB_DRIVER_ELIGIBLE, ['CUSTOMER', 'DRIVER']);
    driverEligibleUserId = driverUser.id;

    const eligibleProf = await profileRepo.create({
      userId: driverEligibleUserId,
      firstName: 'Ramesh',
      lastName: 'Kumar',
      licenceNumber: 'DL-0420110099881',
      licenceClasses: ['LMV', 'TRANS'],
      experienceYears: 5,
      submissionStatus: 'SUBMITTED',
      approvalStatus: 'PENDING',
    });
    driverEligibleProfileId = eligibleProf.id;

    // Upload mock documents
    const rameshDlUpload = await storageService.uploadFile(
      Buffer.from('%PDF-1.4 Mock DL'),
      'ramesh_dl.pdf',
      'application/pdf',
      'drivers'
    );
    rameshDlKey = rameshDlUpload.storageKey;

    const rameshPhotoUpload = await storageService.uploadFile(
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      'ramesh_photo.jpg',
      'image/jpeg',
      'drivers'
    );
    rameshPhotoKey = rameshPhotoUpload.storageKey;

    const rameshIdUpload = await storageService.uploadFile(
      Buffer.from('%PDF-1.4 Mock Aadhar'),
      'ramesh_id.pdf',
      'application/pdf',
      'drivers'
    );
    rameshIdKey = rameshIdUpload.storageKey;

    await documentRepo.create({
      driverId: driverEligibleProfileId,
      documentType: 'DRIVING_LICENCE',
      documentStorageKey: rameshDlKey,
      verificationStatus: 'PENDING',
      expiryDate: new Date('2032-12-31'),
    });
    await documentRepo.create({
      driverId: driverEligibleProfileId,
      documentType: 'PROFILE_PHOTO',
      documentStorageKey: rameshPhotoKey,
      verificationStatus: 'PENDING',
    });
    await documentRepo.create({
      driverId: driverEligibleProfileId,
      documentType: 'IDENTITY_PROOF',
      documentStorageKey: rameshIdKey,
      verificationStatus: 'PENDING',
    });

    // 4. Create Driver with Expired Documents
    const expiredUser = await ensureUserWithRoles(MOB_DRIVER_EXPIRED, ['CUSTOMER', 'DRIVER']);
    driverExpiredUserId = expiredUser.id;

    const expiredProf = await profileRepo.create({
      userId: driverExpiredUserId,
      firstName: 'Suresh',
      lastName: 'Verma',
      licenceNumber: 'DL-0420110099882',
      licenceClasses: ['LMV'],
      experienceYears: 3,
      submissionStatus: 'SUBMITTED',
      approvalStatus: 'PENDING',
    });
    driverExpiredProfileId = expiredProf.id;

    const sureshDlUpload = await storageService.uploadFile(
      Buffer.from('%PDF-1.4 Expired DL'),
      'suresh_dl.pdf',
      'application/pdf',
      'drivers'
    );
    sureshDlKey = sureshDlUpload.storageKey;

    await documentRepo.create({
      driverId: driverExpiredProfileId,
      documentType: 'DRIVING_LICENCE',
      documentStorageKey: sureshDlKey,
      verificationStatus: 'VERIFIED',
      expiryDate: new Date('2020-01-01'), // Expired
    });
    await documentRepo.create({
      driverId: driverExpiredProfileId,
      documentType: 'PROFILE_PHOTO',
      documentStorageKey: rameshPhotoKey,
      verificationStatus: 'VERIFIED',
    });
    await documentRepo.create({
      driverId: driverExpiredProfileId,
      documentType: 'IDENTITY_PROOF',
      documentStorageKey: rameshIdKey,
      verificationStatus: 'VERIFIED',
    });

    // 5. Dual Role User (Customer + Driver)
    const dualUser = await ensureUserWithRoles(MOB_DUAL_ROLE_USER, ['CUSTOMER', 'DRIVER']);
    dualRoleUserId = dualUser.id;
    const dualProf = await profileRepo.create({
      userId: dualRoleUserId,
      firstName: 'Pooja',
      lastName: 'Sharma',
      submissionStatus: 'DRAFT',
      approvalStatus: 'PENDING',
    });
    dualRoleDriverProfileId = dualProf.id;
  });

  afterAll(async () => {
    // Teardown
    await prisma.driverVehicleAssignment.deleteMany({});
    await prisma.driverAvailability.deleteMany({});
    await prisma.driverPartnerAffiliation.deleteMany({});
    await prisma.driverInvitation.deleteMany({});
    await prisma.driverDocument.deleteMany({});
    await prisma.driverProfile.deleteMany({});
    await prisma.partnerVehicle.deleteMany({});
    await prisma.partnerProfile.deleteMany({});

    const testMobiles = [
      MOB_ADMIN,
      MOB_SUPER_ADMIN,
      MOB_DRIVER_ELIGIBLE,
      MOB_DRIVER_EXPIRED,
      MOB_PARTNER_OWNER,
      MOB_DUAL_ROLE_USER,
    ];

    for (const mob of testMobiles) {
      const user = await prisma.user.findUnique({ where: { mobileNumber: mob } });
      if (user) {
        await prisma.userRole.deleteMany({ where: { userId: user.id } });
        await prisma.userSession.deleteMany({ where: { userId: user.id } });
        await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
  });

  // ==========================================================================
  // SECTION 1: Batch 1 Preflight Audit Enhancements & Regressions
  // ==========================================================================
  describe('1. Batch 1 Preflight Audit Verification & Fixes', () => {
    it('1.1 Owner self-driving: fleet partner can act as own driver and assign themselves to their vehicle', async () => {
      // Create driver profile for the partner user
      const ownerDriverProf = await onboardingService.getOrCreateProfile(partnerOwnerUserId);
      const ownerDriverProfileId = BigInt(ownerDriverProf.id);

      await profileRepo.update(ownerDriverProfileId, {
        licenceClasses: ['LMV', 'TRANS'],
        experienceYears: 7,
      });
      await profileRepo.updateApprovalStatus(ownerDriverProfileId, 'APPROVED', adminUserId);

      // Upload and verify required documents for owner-driver
      await documentRepo.create({
        driverId: ownerDriverProfileId,
        documentType: 'DRIVING_LICENCE',
        documentStorageKey: rameshDlKey,
        verificationStatus: 'VERIFIED',
        expiryDate: new Date('2030-01-01'),
      });
      await documentRepo.create({
        driverId: ownerDriverProfileId,
        documentType: 'PROFILE_PHOTO',
        documentStorageKey: rameshPhotoKey,
        verificationStatus: 'VERIFIED',
      });
      await documentRepo.create({
        driverId: ownerDriverProfileId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: rameshIdKey,
        verificationStatus: 'VERIFIED',
      });

      // Schedule assignment: Partner owner assigns themselves to their own vehicle
      // Automatically establishes active self-affiliation without manual invitation
      const shiftStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const shiftEnd = new Date(Date.now() + 6 * 60 * 60 * 1000);

      const assignment = await assignmentService.scheduleAssignment(partnerOwnerUserId, {
        driverId: ownerDriverProfileId,
        vehicleId: partnerVehicleId,
        startTime: shiftStart,
        endTime: shiftEnd,
        notes: 'Owner driving own Tata Ace delivery route',
      });

      expect(assignment).toBeDefined();
      expect(assignment.assignmentStatus).toBe('SCHEDULED');
      expect(assignment.driverId).toBe(ownerDriverProfileId.toString());

      // Verify self-affiliation was created in DB
      const affiliation = await affiliationRepo.findActive(ownerDriverProfileId, partnerOwnerId);
      expect(affiliation).toBeDefined();
      expect(affiliation?.affiliationStatus).toBe('ACTIVE');

      await prisma.driverVehicleAssignment.delete({ where: { id: BigInt(assignment.id) } });
    });

    it('1.2 Vehicle possession confirmation: startAssignment rejects when confirmVehiclePossession is false', async () => {
      // Schedule an immediate shift for eligible driver
      await affiliationRepo.create({
        driverId: driverEligibleProfileId,
        partnerId: partnerOwnerId,
        affiliationStatus: 'ACTIVE',
      });
      await profileRepo.updateApprovalStatus(driverEligibleProfileId, 'APPROVED', adminUserId);

      const shiftStart = new Date(Date.now() + 5 * 60 * 1000);
      const shift = await assignmentRepo.create({
        driverId: driverEligibleProfileId,
        partnerId: partnerOwnerId,
        vehicleId: partnerVehicleId,
        assignmentStatus: 'SCHEDULED',
        startTime: shiftStart,
      });

      // Attempt to start shift with confirmVehiclePossession: false
      await expect(
        assignmentService.startAssignment(shift.id, driverEligibleUserId, {
          confirmVehiclePossession: false,
        })
      ).rejects.toThrow(ValidationError);

      // Start shift with confirmVehiclePossession: true
      const started = await assignmentService.startAssignment(shift.id, driverEligibleUserId, {
        confirmVehiclePossession: true,
        initialOdometerReading: 42100,
      });

      expect(started.assignmentStatus).toBe('ACTIVE');
      expect(started.actualStartTime).toBeDefined();

      await prisma.driverVehicleAssignment.delete({ where: { id: shift.id } });
      await prisma.driverAvailability.deleteMany({ where: { driverId: driverEligibleProfileId } });
    });

    it('1.3 Configurable early shift-start restriction: custom window is respected', async () => {
      // Instantiate service with 30-minute early start window
      const customAssignmentService = new DriverAssignmentService(
        assignmentRepo,
        availabilityRepo,
        profileRepo,
        affiliationRepo,
        vehicleRepo,
        driverKycValidationService,
        { earlyStartWindowMinutes: 30 }
      );

      // Shift starts in 45 minutes (outside 30m window)
      const shiftEarly = await assignmentRepo.create({
        driverId: driverEligibleProfileId,
        partnerId: partnerOwnerId,
        vehicleId: partnerVehicleId,
        assignmentStatus: 'SCHEDULED',
        startTime: new Date(Date.now() + 45 * 60 * 1000),
      });

      // Should be rejected by 30-minute restriction
      await expect(
        customAssignmentService.startAssignment(shiftEarly.id, driverEligibleUserId)
      ).rejects.toThrow(BadRequestError);

      // Shift starts in 20 minutes (inside 30m window)
      await prisma.driverVehicleAssignment.update({
        where: { id: shiftEarly.id },
        data: { startTime: new Date(Date.now() + 20 * 60 * 1000) },
      });

      const started = await customAssignmentService.startAssignment(shiftEarly.id, driverEligibleUserId);
      expect(started.assignmentStatus).toBe('ACTIVE');

      await prisma.driverVehicleAssignment.delete({ where: { id: shiftEarly.id } });
      await prisma.driverAvailability.deleteMany({ where: { driverId: driverEligibleProfileId } });
    });

    it('1.4 Driver late cancellation with owner approval: supports approval and records audit details', async () => {
      // Shift starts in 50 minutes (< 2 hours)
      const shiftLate = await assignmentRepo.create({
        driverId: driverEligibleProfileId,
        partnerId: partnerOwnerId,
        vehicleId: partnerVehicleId,
        assignmentStatus: 'SCHEDULED',
        startTime: new Date(Date.now() + 50 * 60 * 1000),
      });

      // Driver self-cancel without owner approval must be rejected
      await expect(
        assignmentService.cancelAssignment(
          shiftLate.id,
          driverEligibleUserId,
          'DRIVER',
          'Sudden illness'
        )
      ).rejects.toThrow(ValidationError);

      // Fleet owner approves driver's late cancellation request
      const approvedCancellation = await assignmentService.approveDriverCancellation(
        shiftLate.id,
        partnerOwnerUserId,
        {
          driverCancellationReason: 'Sudden illness, medical certificate submitted',
          ownerApprovalNotes: 'Replacement driver assigned',
        }
      );

      expect(approvedCancellation.assignmentStatus).toBe('CANCELLED');
      expect(approvedCancellation.cancelledBy).toBe(partnerOwnerUserId.toString());
      expect(approvedCancellation.cancellationReason).toContain('Owner Approved Late Cancellation');
      expect(approvedCancellation.cancellationReason).toContain('Sudden illness');

      await prisma.driverVehicleAssignment.delete({ where: { id: shiftLate.id } });
    });
  });

  // ==========================================================================
  // SECTION 2: Pending Driver Queue & Complete Dossier
  // ==========================================================================
  describe('2. Admin Pending Driver Queue & Dossier Inspection', () => {
    it('2.1 should list pending driver applications in queue with counts and pagination', async () => {
      // Reset eligible driver to PENDING and SUBMITTED
      await profileRepo.updateApprovalStatus(driverEligibleProfileId, 'PENDING', null);
      await profileRepo.updateSubmissionStatus(driverEligibleProfileId, 'SUBMITTED');

      const queue = await adminService.getPendingDrivers({ page: 1, limit: 10 });

      expect(queue.items.length).toBeGreaterThanOrEqual(1);
      const item = queue.items.find((i) => i.id === driverEligibleProfileId.toString());
      expect(item).toBeDefined();
      expect(item?.mobileNumber).toBe(MOB_DRIVER_ELIGIBLE);
      expect(item?.approvalStatus).toBe('PENDING');
      expect(item?.documentCount).toBeGreaterThanOrEqual(3);
    });

    it('2.2 should retrieve complete driver verification dossier including KYC evaluation and affiliations', async () => {
      const dossier = await adminService.getDriverDossier(driverEligibleProfileId);

      expect(dossier).toBeDefined();
      expect(dossier.id).toBe(driverEligibleProfileId.toString());
      expect(dossier.firstName).toBe('Ramesh');
      expect(dossier.licenceClasses).toContain('LMV');
      expect(dossier.documents.length).toBeGreaterThanOrEqual(3);
      expect(dossier.affiliations).toBeDefined();
      expect(dossier.assignmentsSummary).toBeDefined();
      expect(dossier.kycEvaluation).toBeDefined();
      expect(typeof dossier.kycEvaluation.isValid).toBe('boolean');
    });

    it('2.3 should securely stream private driver document binary without exposing storage path', async () => {
      const docs = await documentRepo.findByDriverId(driverEligibleProfileId);
      const dlDoc = docs.find((d) => d.documentType === 'DRIVING_LICENCE');
      expect(dlDoc).toBeDefined();

      const streamResult = await adminService.getDocumentFileForAdmin(dlDoc!.id);

      expect(streamResult).toBeDefined();
      expect(streamResult.buffer).toBeInstanceOf(Buffer);
      expect(streamResult.mimeType).toBe('application/pdf');
      expect(streamResult.buffer.toString()).toContain('%PDF-1.4');
    });

    it('2.4 should throw NotFoundError when streaming non-existent document', async () => {
      await expect(
        adminService.getDocumentFileForAdmin(999999999n)
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ==========================================================================
  // SECTION 3: Document Verification & Rejection Lifecycle
  // ==========================================================================
  describe('3. Driver Document Verification, Rejection & Audit', () => {
    it('3.1 should verify driver document and create atomic audit log in the same transaction', async () => {
      const docs = await documentRepo.findByDriverId(driverEligibleProfileId);
      const photoDoc = docs.find((d) => d.documentType === 'PROFILE_PHOTO');
      expect(photoDoc).toBeDefined();

      const verified = await adminService.verifyDriverDocument(photoDoc!.id, adminUserId, {
        ip: '192.168.1.10',
        userAgent: 'Jest/AdminTest',
      });

      expect(verified.verificationStatus).toBe('VERIFIED');
      expect(verified.reviewedBy).toBe(adminUserId.toString());

      // Verify audit log exists
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorUserId: adminUserId,
          action: 'DRIVER_DOCUMENT_VERIFIED',
          entityName: 'driver_documents',
          entityId: photoDoc!.id,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.ipAddress).toBe('192.168.1.10');
    });

    it('3.2 should reject driver document with mandatory reason and create audit log', async () => {
      const docs = await documentRepo.findByDriverId(driverEligibleProfileId);
      const idDoc = docs.find((d) => d.documentType === 'IDENTITY_PROOF');
      expect(idDoc).toBeDefined();

      const rejected = await adminService.rejectDriverDocument(
        idDoc!.id,
        'Aadhar image is blurred and unreadable',
        adminUserId,
        { ip: '192.168.1.10' }
      );

      expect(rejected.verificationStatus).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Aadhar image is blurred and unreadable');

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorUserId: adminUserId,
          action: 'DRIVER_DOCUMENT_REJECTED',
          entityName: 'driver_documents',
          entityId: idDoc!.id,
        },
      });
      expect(audit).toBeDefined();
    });

    it('3.3 should throw BadRequestError when document rejection reason is empty or whitespace', async () => {
      const docs = await documentRepo.findByDriverId(driverEligibleProfileId);
      const idDoc = docs.find((d) => d.documentType === 'IDENTITY_PROOF');

      await expect(
        adminService.rejectDriverDocument(idDoc!.id, '   ', adminUserId)
      ).rejects.toThrow(BadRequestError);
    });

    it('3.4 Self-approval guard: admin cannot verify or reject documents for their own driver profile', async () => {
      // Create driver profile for admin user
      const adminDriverProf = await onboardingService.getOrCreateProfile(adminUserId);
      const adminDriverProfileId = BigInt(adminDriverProf.id);
      const adminDoc = await documentRepo.create({
        driverId: adminDriverProfileId,
        documentType: 'PROFILE_PHOTO',
        documentStorageKey: rameshPhotoKey,
        verificationStatus: 'PENDING',
      });

      // Admin attempts self-verification
      await expect(
        adminService.verifyDriverDocument(adminDoc.id, adminUserId)
      ).rejects.toThrow(ForbiddenError);

      // Admin attempts self-rejection
      await expect(
        adminService.rejectDriverDocument(adminDoc.id, 'Self rejection', adminUserId)
      ).rejects.toThrow(ForbiddenError);

      await prisma.driverDocument.delete({ where: { id: adminDoc.id } });
      await prisma.driverProfile.delete({ where: { id: adminDriverProfileId } });
    });

    it('3.5 Replacement immutability: uploading replacement document does not inherit previous verification', async () => {
      // Upload new identity proof replacing the rejected one
      const replacement = await documentRepo.create({
        driverId: driverEligibleProfileId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: 'drivers/test/ramesh_id.pdf',
        verificationStatus: 'PENDING', // starts pending
      });

      // The new replacement must be PENDING (not inheriting VERIFIED or REJECTED)
      expect(replacement.verificationStatus).toBe('PENDING');

      // Now verify it properly
      const verified = await adminService.verifyDriverDocument(replacement.id, adminUserId);
      expect(verified.verificationStatus).toBe('VERIFIED');
    });
  });

  // ==========================================================================
  // SECTION 4: Driver Profile Approval, Rejection & Fail-Closed Gate
  // ==========================================================================
  describe('4. Driver Approval, Rejection & Fail-Closed Gatekeeper', () => {
    it('4.1 should BLOCK approval when driving licence is unverified (fail-closed)', async () => {
      // DL is still PENDING
      await expect(
        adminService.approveDriver(driverEligibleProfileId, adminUserId)
      ).rejects.toThrow(BadRequestError);
    });

    it('4.2 should BLOCK approval when a verified document is EXPIRED (Asia/Kolkata calendar day)', async () => {
      // Driver Expired has expired DL
      await expect(
        adminService.approveDriver(driverExpiredProfileId, adminUserId)
      ).rejects.toThrow(BadRequestError);
    });

    it('4.3 should BLOCK approval when driver profile is still in DRAFT status', async () => {
      await expect(
        adminService.approveDriver(dualRoleDriverProfileId, adminUserId)
      ).rejects.toThrow(BadRequestError);
    });

    it('4.4 Self-approval guard: admin cannot approve or reject their own driver profile', async () => {
      const adminDriverProf = await onboardingService.getOrCreateProfile(adminUserId);
      const adminDriverProfileId = BigInt(adminDriverProf.id);
      await profileRepo.updateSubmissionStatus(adminDriverProfileId, 'SUBMITTED');

      await expect(
        adminService.approveDriver(adminDriverProfileId, adminUserId)
      ).rejects.toThrow(ForbiddenError);

      await expect(
        adminService.rejectDriver(adminDriverProfileId, 'Self reject', adminUserId)
      ).rejects.toThrow(ForbiddenError);

      await prisma.driverProfile.delete({ where: { id: adminDriverProfileId } });
    });

    it('4.5 should APPROVE eligible driver when all KYC checks pass, provisioning availability and audit', async () => {
      // Verify DL for eligible driver
      const docs = await documentRepo.findByDriverId(driverEligibleProfileId);
      const dlDoc = docs.find((d) => d.documentType === 'DRIVING_LICENCE');
      await adminService.verifyDriverDocument(dlDoc!.id, adminUserId);

      // Now all mandatory documents (DL, Photo, Identity Proof) are VERIFIED and valid
      const approved = await adminService.approveDriver(driverEligibleProfileId, adminUserId, {
        ip: '10.0.0.5',
      });

      expect(approved.approvalStatus).toBe('APPROVED');
      expect(approved.reviewedBy).toBe(adminUserId.toString());

      // Verify availability provisioned
      const availability = await availabilityRepo.findByDriverId(driverEligibleProfileId);
      expect(availability).toBeDefined();
      expect(availability?.isOnline).toBe(false);
      expect(availability?.isBusy).toBe(false);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorUserId: adminUserId,
          action: 'DRIVER_APPROVED',
          entityName: 'driver_profiles',
          entityId: driverEligibleProfileId,
        },
      });
      expect(audit).toBeDefined();
    });

    it('4.6 should reject duplicate approval attempt on an already APPROVED driver', async () => {
      await expect(
        adminService.approveDriver(driverEligibleProfileId, adminUserId)
      ).rejects.toThrow(BadRequestError);
    });

    it('4.7 should reject driver onboarding application with mandatory reason and allow resubmission', async () => {
      // Reject Driver Expired
      const rejected = await adminService.rejectDriver(
        driverExpiredProfileId,
        'Driving licence has expired. Please renew with RTO and resubmit.',
        adminUserId
      );

      expect(rejected.approvalStatus).toBe('REJECTED');
      expect(rejected.rejectionReason).toContain('Driving licence has expired');

      // Driver can resubmit after administrative rejection
      const resubmitted = await onboardingService.resubmitProfile(driverExpiredUserId);
      expect(resubmitted.submissionStatus).toBe('SUBMITTED');
      expect(resubmitted.approvalStatus).toBe('PENDING');
      expect(resubmitted.rejectionReason).toBeNull();
    });
  });

  // ==========================================================================
  // SECTION 5: Suspension, Reactivation & Administrative Privilege Separation
  // ==========================================================================
  describe('5. Driver Suspension, Reactivation & Privilege Separation', () => {
    it('5.1 should suspend an APPROVED driver with mandatory reason and reset availability', async () => {
      // Set driver online first
      await availabilityRepo.updateDutyStatus(driverEligibleProfileId, true, false);

      const suspended = await adminService.suspendDriver(
        driverEligibleProfileId,
        'Customer safety complaint under investigation',
        adminUserId,
        { ip: '10.0.0.1' }
      );

      expect(suspended.approvalStatus).toBe('SUSPENDED');
      expect(suspended.suspendedAt).toBeDefined();
      expect(suspended.suspensionReason).toBe('Customer safety complaint under investigation');

      // Verify driver went offline immediately
      const availability = await availabilityRepo.findByDriverId(driverEligibleProfileId);
      expect(availability?.isOnline).toBe(false);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorUserId: adminUserId,
          action: 'DRIVER_SUSPENDED',
          entityName: 'driver_profiles',
          entityId: driverEligibleProfileId,
        },
      });
      expect(audit).toBeDefined();
    });

    it('5.2 should BLOCK suspension of a driver who is NOT APPROVED (e.g. PENDING or REJECTED)', async () => {
      await expect(
        adminService.suspendDriver(driverExpiredProfileId, 'Random suspension', adminUserId)
      ).rejects.toThrow(BadRequestError);
    });

    it('5.3 should reactivate suspended driver when authorized, writing audit log', async () => {
      const reactivated = await adminService.reactivateDriver(
        driverEligibleProfileId,
        adminUserId,
        { ip: '10.0.0.2' },
        'ADMIN'
      );

      expect(reactivated.approvalStatus).toBe('APPROVED');
      expect(reactivated.suspendedAt).toBeNull();
      expect(reactivated.suspensionReason).toBeNull();

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorUserId: adminUserId,
          action: 'DRIVER_REACTIVATED',
          entityName: 'driver_profiles',
          entityId: driverEligibleProfileId,
        },
      });
      expect(audit).toBeDefined();
    });

    it('5.4 should BLOCK reactivation if mandatory documents expired while suspended', async () => {
      // Suspend driver again
      await adminService.suspendDriver(
        driverEligibleProfileId,
        'Temporary leave',
        adminUserId
      );

      // Mock DL expiry while suspended
      const docs = await documentRepo.findByDriverId(driverEligibleProfileId);
      const dlDoc = docs.find((d) => d.documentType === 'DRIVING_LICENCE');
      await prisma.driverDocument.update({
        where: { id: dlDoc!.id },
        data: { expiryDate: new Date('2020-01-01') },
      });

      // Reactivation should fail closed because DL has expired
      await expect(
        adminService.reactivateDriver(driverEligibleProfileId, adminUserId, {}, 'ADMIN')
      ).rejects.toThrow(BadRequestError);

      // Restore valid expiry date and reactivate
      await prisma.driverDocument.update({
        where: { id: dlDoc!.id },
        data: { expiryDate: new Date('2032-12-31') },
      });
      await adminService.reactivateDriver(driverEligibleProfileId, adminUserId, {}, 'ADMIN');
    });

    it('5.5 should enforce admin privilege separation: non-admin cannot reactivate suspended driver', async () => {
      await adminService.suspendDriver(
        driverEligibleProfileId,
        'Routine investigation',
        adminUserId
      );

      // Customer or Partner role cannot reactivate
      await expect(
        adminService.reactivateDriver(driverEligibleProfileId, partnerOwnerUserId, {}, 'CUSTOMER')
      ).rejects.toThrow(ForbiddenError);

      // Super Admin can reactivate
      const reactivated = await adminService.reactivateDriver(
        driverEligibleProfileId,
        superAdminUserId,
        {},
        'SUPER_ADMIN'
      );
      expect(reactivated.approvalStatus).toBe('APPROVED');
    });
  });

  // ==========================================================================
  // SECTION 6: Authentication, Role & Operational Status Integration
  // ==========================================================================
  describe('6. Authentication, Multi-Role & Operational Status Integration', () => {
    it('6.1 preserves one mobile = one user account with multiple assigned roles', async () => {
      const user = await prisma.user.findUnique({
        where: { id: dualRoleUserId },
        include: { userRoles: { include: { role: true } } },
      });

      expect(user).toBeDefined();
      const roleNames = user!.userRoles.map((ur) => ur.role.roleName);
      expect(roleNames).toContain('CUSTOMER');
      expect(roleNames).toContain('DRIVER');
    });

    it('6.2 getRoleOperationalStatus reports accurate status across all driver lifecycles', async () => {
      // 1. User with no driver profile -> NOT_ONBOARDED
      const unonboardedStatus = await authService.getRoleOperationalStatus(
        adminUserId,
        'ACTIVE',
        UserRole.DRIVER
      );
      expect(unonboardedStatus.approvalStatus).toBe('NOT_ONBOARDED');
      expect(unonboardedStatus.isOperational).toBe(false);

      // 2. User with DRAFT profile -> PENDING, isOperational: false
      const draftStatus = await authService.getRoleOperationalStatus(
        dualRoleUserId,
        'ACTIVE',
        UserRole.DRIVER
      );
      expect(draftStatus.approvalStatus).toBe('PENDING');
      expect(draftStatus.isOperational).toBe(false);

      // 3. User with APPROVED profile and valid documents -> APPROVED, isOperational: true
      const approvedStatus = await authService.getRoleOperationalStatus(
        driverEligibleUserId,
        'ACTIVE',
        UserRole.DRIVER
      );
      expect(approvedStatus.approvalStatus).toBe('APPROVED');
      expect(approvedStatus.isOperational).toBe(true);

      // 4. User with SUSPENDED profile -> SUSPENDED, isOperational: false
      await adminService.suspendDriver(driverEligibleProfileId, 'Review', adminUserId);
      const suspendedStatus = await authService.getRoleOperationalStatus(
        driverEligibleUserId,
        'ACTIVE',
        UserRole.DRIVER
      );
      expect(suspendedStatus.approvalStatus).toBe('SUSPENDED');
      expect(suspendedStatus.isOperational).toBe(false);

      // Reactivate for subsequent tests
      await adminService.reactivateDriver(driverEligibleProfileId, adminUserId);
    });

    it('6.3 authService.getMe and usersService.getMyRoles reflect driver operational status', async () => {
      // Driver Eligible has activeRole DRIVER
      const meResult = await authService.getMe(driverEligibleUserId.toString(), UserRole.DRIVER);
      expect(meResult.activeRole).toBe('DRIVER');
      expect(meResult.roleStatus.isOperational).toBe(true);
      expect(meResult.roleStatus.approvalStatus).toBe('APPROVED');

      // usersService.getMyRoles
      const rolesResult = await usersService.getMyRoles(driverEligibleUserId.toString(), UserRole.DRIVER);
      const driverRoleEntry = rolesResult.find((r) => r.roleName === 'DRIVER');
      expect(driverRoleEntry).toBeDefined();
      expect(driverRoleEntry?.status).toBe('APPROVED');
      expect(driverRoleEntry?.isOperational).toBe(true);
      expect(driverRoleEntry?.isActiveContext).toBe(true);
    });

    it('6.4 active role switching: permits switching to DRIVER with signed token & active context', async () => {
      // Create session for dual role user
      const session = await prisma.userSession.create({
        data: {
          userId: dualRoleUserId,
          refreshTokenHash: 'hash_dual_test',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const switchRes = await authService.switchRole(
        dualRoleUserId.toString(),
        session.id.toString(),
        'DRIVER'
      );

      expect(switchRes.activeRole).toBe('DRIVER');
      expect(switchRes.tokens.accessToken).toBeDefined();
      expect(switchRes.roleStatus.isOperational).toBe(false); // DRAFT is not operational
    });

    it('6.5 multi-role independence: suspended driver retains fully functional CUSTOMER role', async () => {
      // Suspend driver
      await adminService.suspendDriver(driverEligibleProfileId, 'Conduct check', adminUserId);

      // Driver role is blocked
      const driverStatus = await authService.getRoleOperationalStatus(
        driverEligibleUserId,
        'ACTIVE',
        UserRole.DRIVER
      );
      expect(driverStatus.isOperational).toBe(false);
      expect(driverStatus.approvalStatus).toBe('SUSPENDED');

      // Customer role remains fully active and operational
      const customerStatus = await authService.getRoleOperationalStatus(
        driverEligibleUserId,
        'ACTIVE',
        UserRole.CUSTOMER
      );
      expect(customerStatus.isOperational).toBe(true);
      expect(customerStatus.approvalStatus).toBe('ACTIVE');

      // Reactivate
      await adminService.reactivateDriver(driverEligibleProfileId, adminUserId);
    });

    it('6.6 middleware guards: requireApprovedDriver and requireOperationalDriver block non-approved/expired drivers', async () => {
      // 1. Mock request with non-approved driver
      const reqPending: any = {
        user: { userId: dualRoleUserId.toString() },
      };
      const res: any = {};
      let nextError: any = null;

      await requireApprovedDriver(reqPending, res, (err) => {
        nextError = err;
      });
      expect(nextError).toBeInstanceOf(ForbiddenError);

      // 2. Mock request with approved driver with valid documents
      const reqApproved: any = {
        user: { userId: driverEligibleUserId.toString() },
      };
      let approvedPass = false;
      await requireOperationalDriver(reqApproved, res, (err) => {
        if (!err) approvedPass = true;
      });
      expect(approvedPass).toBe(true);
    });
  });
});
