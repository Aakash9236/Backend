import { Request, Response, NextFunction } from 'express';
import { prisma } from '../src/config/db.config';
import { UserRole } from '../src/common/constants';
import {
  requireWorker,
  requireActiveWorker,
} from '../src/common/middlewares/auth.middleware';
import {
  requireWorkerProfile,
  requireApprovedWorker,
  requireOperationalWorker,
} from '../src/modules/workers/workers.middleware';
import {
  updateWorkerProfileSchema,
  uploadWorkerDocumentSchema,
  addWorkerSkillSchema,
  createWorkerInvitationSchema,
  revokeWorkerInvitationSchema,
  acceptWorkerInvitationSchema,
  rejectWorkerInvitationSchema,
  lookupWorkerInvitationSchema,
  terminateAffiliationSchema,
  updateDutyStatusSchema,
  workerHeartbeatSchema,
  adminRejectWorkerSchema,
  adminSuspendWorkerSchema,
  adminRejectDocumentSchema,
  adminRejectSkillSchema,
  paginationQuerySchema,
  workerApplicationFilterQuerySchema,
  workerInvitationFilterQuerySchema,
} from '../src/modules/workers/workers.validator';
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6E Batch 5 — Step 1: Worker Middleware & Validation Layer', () => {
  // Test isolation mobiles
  const MOB_ACTIVE_WORKER = '+919955000001';
  const MOB_PENDING_WORKER = '+919955000002';
  const MOB_REJECTED_WORKER = '+919955000003';
  const MOB_SUSPENDED_WORKER = '+919955000004';
  const MOB_BLOCKED_USER = '+919955000005';
  const MOB_NO_PROFILE = '+919955000006';

  let activeWorkerUserId: bigint;
  let activeWorkerProfileId: bigint;

  let pendingWorkerUserId: bigint;
  let pendingWorkerProfileId: bigint;

  let rejectedWorkerUserId: bigint;
  let rejectedWorkerProfileId: bigint;

  let suspendedWorkerUserId: bigint;
  let suspendedWorkerProfileId: bigint;

  let blockedUserWorkerId: bigint;
  let blockedUserWorkerProfileId: bigint;

  let noProfileUserId: bigint;

  beforeAll(async () => {
    // 1. Cleanup existing test data
    const testMobiles = [
      MOB_ACTIVE_WORKER,
      MOB_PENDING_WORKER,
      MOB_REJECTED_WORKER,
      MOB_SUSPENDED_WORKER,
      MOB_BLOCKED_USER,
      MOB_NO_PROFILE,
    ];

    const users = await prisma.user.findMany({
      where: { mobileNumber: { in: testMobiles } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    if (userIds.length > 0) {
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

    // 2. Roles
    const workerRole =
      (await prisma.role.findUnique({ where: { roleName: 'WORKER' } })) ||
      (await prisma.role.create({ data: { roleName: 'WORKER', description: 'Worker' } }));

    // 3. Seed Users & Profiles
    // A. Active Worker (Approved, Active User)
    const uActive = await prisma.user.create({
      data: { mobileNumber: MOB_ACTIVE_WORKER, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    activeWorkerUserId = uActive.id;
    await prisma.userRole.create({ data: { userId: activeWorkerUserId, roleId: workerRole.id } });
    const pActive = await prisma.workerProfile.create({
      data: {
        userId: activeWorkerUserId,
        firstName: 'Active',
        lastName: 'Worker',
        workerType: 'TECHNICIAN',
        approvalStatus: 'APPROVED',
        submissionStatus: 'APPROVED',
      },
    });
    activeWorkerProfileId = pActive.id;

    // B. Pending Worker (Under Review)
    const uPending = await prisma.user.create({
      data: { mobileNumber: MOB_PENDING_WORKER, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    pendingWorkerUserId = uPending.id;
    await prisma.userRole.create({ data: { userId: pendingWorkerUserId, roleId: workerRole.id } });
    const pPending = await prisma.workerProfile.create({
      data: {
        userId: pendingWorkerUserId,
        firstName: 'Pending',
        lastName: 'Worker',
        workerType: 'HELPER',
        approvalStatus: 'PENDING',
        submissionStatus: 'SUBMITTED',
      },
    });
    pendingWorkerProfileId = pPending.id;

    // C. Rejected Worker
    const uRejected = await prisma.user.create({
      data: { mobileNumber: MOB_REJECTED_WORKER, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    rejectedWorkerUserId = uRejected.id;
    await prisma.userRole.create({ data: { userId: rejectedWorkerUserId, roleId: workerRole.id } });
    const pRejected = await prisma.workerProfile.create({
      data: {
        userId: rejectedWorkerUserId,
        firstName: 'Rejected',
        lastName: 'Worker',
        workerType: 'HELPER',
        approvalStatus: 'REJECTED',
        submissionStatus: 'REJECTED',
        rejectionReason: 'Failed background verification',
      },
    });
    rejectedWorkerProfileId = pRejected.id;

    // D. Suspended Worker
    const uSuspended = await prisma.user.create({
      data: { mobileNumber: MOB_SUSPENDED_WORKER, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    suspendedWorkerUserId = uSuspended.id;
    await prisma.userRole.create({ data: { userId: suspendedWorkerUserId, roleId: workerRole.id } });
    const pSuspended = await prisma.workerProfile.create({
      data: {
        userId: suspendedWorkerUserId,
        firstName: 'Suspended',
        lastName: 'Worker',
        workerType: 'TECHNICIAN',
        approvalStatus: 'SUSPENDED',
        suspendedAt: new Date(),
        suspensionReason: 'Customer safety incident',
      },
    });
    suspendedWorkerProfileId = pSuspended.id;

    // E. Blocked User with Approved Profile
    const uBlocked = await prisma.user.create({
      data: { mobileNumber: MOB_BLOCKED_USER, isMobileVerified: true, accountStatus: 'BLOCKED' },
    });
    blockedUserWorkerId = uBlocked.id;
    await prisma.userRole.create({ data: { userId: blockedUserWorkerId, roleId: workerRole.id } });
    const pBlocked = await prisma.workerProfile.create({
      data: {
        userId: blockedUserWorkerId,
        firstName: 'Blocked',
        lastName: 'UserWorker',
        workerType: 'TECHNICIAN',
        approvalStatus: 'APPROVED',
      },
    });
    blockedUserWorkerProfileId = pBlocked.id;

    // F. User with No Profile
    const uNoProfile = await prisma.user.create({
      data: { mobileNumber: MOB_NO_PROFILE, isMobileVerified: true, accountStatus: 'ACTIVE' },
    });
    noProfileUserId = uNoProfile.id;
  });

  afterAll(async () => {
    const testMobiles = [
      MOB_ACTIVE_WORKER,
      MOB_PENDING_WORKER,
      MOB_REJECTED_WORKER,
      MOB_SUSPENDED_WORKER,
      MOB_BLOCKED_USER,
      MOB_NO_PROFILE,
    ];

    const users = await prisma.user.findMany({
      where: { mobileNumber: { in: testMobiles } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    if (userIds.length > 0) {
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

  // ==========================================================================
  // 1. Authentication Helpers (requireWorker & requireActiveWorker)
  // ==========================================================================
  describe('1. Authentication Helpers', () => {
    it('requireWorker should call next() when user has WORKER role', () => {
      const req: any = {
        user: { userId: '1', roles: [UserRole.WORKER, UserRole.CUSTOMER] },
      };
      let called = false;
      let err: any = null;

      requireWorker(req, {} as Response, (e?: any) => {
        called = true;
        err = e;
      });

      expect(called).toBe(true);
      expect(err).toBeUndefined();
    });

    it('requireWorker should pass ForbiddenError when user lacks WORKER role', () => {
      const req: any = {
        user: { userId: '1', roles: [UserRole.CUSTOMER] },
      };
      let err: any = null;

      requireWorker(req, {} as Response, (e?: any) => {
        err = e;
      });

      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.message).toContain('Access forbidden: You do not have the required role (WORKER)');
    });

    it('requireWorker should pass UnauthorizedError when req.user is missing', () => {
      const req: any = {};
      let err: any = null;

      requireWorker(req, {} as Response, (e?: any) => {
        err = e;
      });

      expect(err).toBeInstanceOf(UnauthorizedError);
    });

    it('requireActiveWorker should call next() when activeRole is WORKER and held in roles', () => {
      const req: any = {
        user: { userId: '1', roles: [UserRole.WORKER], activeRole: UserRole.WORKER },
      };
      let called = false;
      let err: any = null;

      requireActiveWorker(req, {} as Response, (e?: any) => {
        called = true;
        err = e;
      });

      expect(called).toBe(true);
      expect(err).toBeUndefined();
    });

    it('requireActiveWorker should pass ForbiddenError when activeRole is not WORKER', () => {
      const req: any = {
        user: {
          userId: '1',
          roles: [UserRole.WORKER, UserRole.CUSTOMER],
          activeRole: UserRole.CUSTOMER,
        },
      };
      let err: any = null;

      requireActiveWorker(req, {} as Response, (e?: any) => {
        err = e;
      });

      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.message).toContain("current active context is 'CUSTOMER'");
    });

    it('requireActiveWorker should pass UnauthorizedError when activeRole is missing', () => {
      const req: any = {
        user: { userId: '1', roles: [UserRole.WORKER] }, // no activeRole and not CUSTOMER
      };
      let err: any = null;

      requireActiveWorker(req, {} as Response, (e?: any) => {
        err = e;
      });

      expect(err).toBeInstanceOf(UnauthorizedError);
      expect(err.message).toContain('Active role context is missing from token');
    });
  });

  // ==========================================================================
  // 2. Worker Zod Validators
  // ==========================================================================
  describe('2. Worker Zod Validators', () => {
    describe('updateWorkerProfileSchema', () => {
      it('should accept valid profile update payload', () => {
        const valid = {
          firstName: 'Ramesh',
          lastName: 'Kumar',
          dateOfBirth: '1990-05-15',
          gender: 'MALE',
          bio: 'Experienced certified plumber and electrician',
          experienceYears: 7,
          workerType: 'TECHNICIAN',
          primaryCityId: '10',
        };
        const parsed = updateWorkerProfileSchema.parse(valid);
        expect(parsed.firstName).toBe('Ramesh');
        expect(parsed.workerType).toBe('TECHNICIAN');
      });

      it('should reject invalid workerType enum', () => {
        const invalid = { workerType: 'PILOT' };
        expect(() => updateWorkerProfileSchema.parse(invalid)).toThrow(
          "Worker type must be one of 'HELPER', 'TECHNICIAN', or 'SPECIALIST'"
        );
      });

      it('should reject invalid gender enum', () => {
        const invalid = { gender: 'UNKNOWN' };
        expect(() => updateWorkerProfileSchema.parse(invalid)).toThrow(
          "Gender must be one of 'MALE', 'FEMALE', or 'OTHER'"
        );
      });

      it('should reject negative experienceYears', () => {
        const invalid = { experienceYears: -3 };
        expect(() => updateWorkerProfileSchema.parse(invalid)).toThrow(
          'Experience years must be >= 0'
        );
      });

      it('should reject experienceYears greater than 60', () => {
        const invalid = { experienceYears: 65 };
        expect(() => updateWorkerProfileSchema.parse(invalid)).toThrow(
          'Experience years cannot exceed 60'
        );
      });

      it('should reject client-supplied privileged fields (strict mode)', () => {
        const privileged = {
          firstName: 'Ramesh',
          approvalStatus: 'APPROVED',
          submissionStatus: 'APPROVED',
          userId: '123',
          isSuspended: false,
        };
        expect(() => updateWorkerProfileSchema.parse(privileged)).toThrow();
      });
    });

    describe('uploadWorkerDocumentSchema', () => {
      it('should accept valid document metadata', () => {
        const valid = {
          documentType: 'IDENTITY_PROOF',
          documentNumber: 'AADHAAR-1234-5678-9012',
          expiryDate: '2030-12-31',
        };
        const parsed = uploadWorkerDocumentSchema.parse(valid);
        expect(parsed.documentType).toBe('IDENTITY_PROOF');
      });

      it('should reject invalid documentType', () => {
        const invalid = { documentType: 'PASSPORT_UK' };
        expect(() => uploadWorkerDocumentSchema.parse(invalid)).toThrow(
          'Invalid document type'
        );
      });

      it('should reject malformed expiryDate', () => {
        const invalid = {
          documentType: 'IDENTITY_PROOF',
          expiryDate: '31-12-2030', // not YYYY-MM-DD
        };
        expect(() => uploadWorkerDocumentSchema.parse(invalid)).toThrow(
          'Expiry date must be in YYYY-MM-DD format'
        );
      });
    });

    describe('addWorkerSkillSchema', () => {
      it('should accept valid skill payload with string ID', () => {
        const parsed = addWorkerSkillSchema.parse({
          serviceCategoryId: '5',
          experienceYears: 3,
        });
        expect(parsed.serviceCategoryId).toBe('5');
        expect(parsed.experienceYears).toBe(3);
      });

      it('should accept valid skill payload with number ID', () => {
        const parsed = addWorkerSkillSchema.parse({
          serviceCategoryId: 5,
        });
        expect(parsed.serviceCategoryId).toBe(5);
        expect(parsed.experienceYears).toBeUndefined();
      });

      it('should reject empty serviceCategoryId', () => {
        expect(() => addWorkerSkillSchema.parse({ serviceCategoryId: '' })).toThrow(
          'Service category ID is required'
        );
      });

      it('should reject negative experienceYears', () => {
        expect(() =>
          addWorkerSkillSchema.parse({ serviceCategoryId: '5', experienceYears: -1 })
        ).toThrow('Experience years must be >= 0');
      });
    });

    describe('Invitation Schemas', () => {
      it('createWorkerInvitationSchema should accept valid Indian mobile number and details', () => {
        const valid = {
          invitedMobile: '+919876543210',
          workerName: 'Sanjay Dutt',
          proposedRole: 'Senior Electrician',
          notes: 'Joining Bengaluru team',
        };
        const parsed = createWorkerInvitationSchema.parse(valid);
        expect(parsed.invitedMobile).toBe('+919876543210');
      });

      it('createWorkerInvitationSchema should reject invalid or empty mobile', () => {
        expect(() =>
          createWorkerInvitationSchema.parse({ invitedMobile: '9876543210' })
        ).toThrow('Invalid Indian mobile number format');
        expect(() =>
          createWorkerInvitationSchema.parse({ invitedMobile: '' })
        ).toThrow('Invited mobile number is required');
      });

      it('revokeWorkerInvitationSchema should require non-empty reason', () => {
        expect(() => revokeWorkerInvitationSchema.parse({ reason: '' })).toThrow(
          'Revocation reason is mandatory'
        );
        const parsed = revokeWorkerInvitationSchema.parse({ reason: 'Position closed' });
        expect(parsed.reason).toBe('Position closed');
      });

      it('acceptWorkerInvitationSchema should accept optional notes', () => {
        const parsed = acceptWorkerInvitationSchema.parse({ notes: 'Glad to join' });
        expect(parsed.notes).toBe('Glad to join');
      });

      it('rejectWorkerInvitationSchema should accept optional reason', () => {
        const parsed = rejectWorkerInvitationSchema.parse({ reason: 'Not interested' });
        expect(parsed.reason).toBe('Not interested');
      });

      it('lookupWorkerInvitationSchema should validate raw token length and reject short/empty tokens', () => {
        expect(() => lookupWorkerInvitationSchema.parse({ token: 'short' })).toThrow(
          'Invitation token must be at least 16 characters'
        );
        const validToken = 'abcdef1234567890abcdef1234567890';
        const parsed = lookupWorkerInvitationSchema.parse({ token: validToken });
        expect(parsed.token).toBe(validToken);
      });
    });

    describe('terminateAffiliationSchema', () => {
      it('should require non-empty reason', () => {
        expect(() => terminateAffiliationSchema.parse({ reason: '   ' })).toThrow(
          'Termination reason is mandatory'
        );
        const parsed = terminateAffiliationSchema.parse({ reason: 'Mutual agreement' });
        expect(parsed.reason).toBe('Mutual agreement');
      });
    });

    describe('Availability & Heartbeat Schemas', () => {
      it('updateDutyStatusSchema should accept valid duty status with optional coordinates', () => {
        const parsedWithCoords = updateDutyStatusSchema.parse({
          isOnline: true,
          latitude: 12.9716,
          longitude: 77.5946,
        });
        expect(parsedWithCoords.isOnline).toBe(true);
        expect(parsedWithCoords.latitude).toBe(12.9716);

        const parsedWithoutCoords = updateDutyStatusSchema.parse({
          isOnline: false,
        });
        expect(parsedWithoutCoords.isOnline).toBe(false);
        expect(parsedWithoutCoords.latitude).toBeUndefined();
      });

      it('updateDutyStatusSchema should reject invalid coordinates out of range', () => {
        expect(() =>
          updateDutyStatusSchema.parse({ isOnline: true, latitude: 95.0 })
        ).toThrow('Latitude must be between -90 and 90');
        expect(() =>
          updateDutyStatusSchema.parse({ isOnline: true, longitude: -190.0 })
        ).toThrow('Longitude must be between -180 and 180');
      });

      it('workerHeartbeatSchema should accept valid optional coordinates', () => {
        const parsed = workerHeartbeatSchema.parse({
          latitude: 19.076,
          longitude: 72.8777,
        });
        expect(parsed.latitude).toBe(19.076);
      });

      it('workerHeartbeatSchema should reject coordinates out of range', () => {
        expect(() => workerHeartbeatSchema.parse({ latitude: -95 })).toThrow(
          'Latitude must be between -90 and 90'
        );
      });
    });

    describe('Admin Governance Schemas', () => {
      it('adminRejectWorkerSchema should require non-empty trimmed reason', () => {
        expect(() => adminRejectWorkerSchema.parse({ reason: '  ' })).toThrow(
          'Worker rejection reason is mandatory'
        );
        const parsed = adminRejectWorkerSchema.parse({ reason: 'Incomplete documentation' });
        expect(parsed.reason).toBe('Incomplete documentation');
      });

      it('adminSuspendWorkerSchema should require non-empty reason', () => {
        expect(() => adminSuspendWorkerSchema.parse({ reason: '' })).toThrow(
          'Worker suspension reason is mandatory'
        );
        const parsed = adminSuspendWorkerSchema.parse({ reason: 'Fraudulent activity reported' });
        expect(parsed.reason).toBe('Fraudulent activity reported');
      });

      it('adminRejectDocumentSchema should require non-empty reason', () => {
        expect(() => adminRejectDocumentSchema.parse({ reason: '' })).toThrow(
          'Document rejection reason is mandatory'
        );
      });

      it('adminRejectSkillSchema should require non-empty reason', () => {
        expect(() => adminRejectSkillSchema.parse({ reason: '' })).toThrow(
          'Skill rejection reason is mandatory'
        );
      });
    });

    describe('Pagination and Filter Query Schemas', () => {
      it('paginationQuerySchema should coerce and default page and limit', () => {
        const defaulted = paginationQuerySchema.parse({});
        expect(defaulted.page).toBe(1);
        expect(defaulted.limit).toBe(20);

        const parsed = paginationQuerySchema.parse({ page: '3', limit: '50' });
        expect(parsed.page).toBe(3);
        expect(parsed.limit).toBe(50);
      });

      it('paginationQuerySchema should enforce positive page and max limit 100', () => {
        expect(() => paginationQuerySchema.parse({ page: '0' })).toThrow(
          'Page must be a positive integer'
        );
        expect(() => paginationQuerySchema.parse({ limit: '150' })).toThrow(
          'Limit cannot exceed 100'
        );
      });

      it('workerApplicationFilterQuerySchema should parse valid filters', () => {
        const parsed = workerApplicationFilterQuerySchema.parse({
          page: '1',
          limit: '10',
          approvalStatus: 'PENDING',
          workerType: 'TECHNICIAN',
          search: 'Kumar',
          isActive: 'true',
        });
        expect(parsed.approvalStatus).toBe('PENDING');
        expect(parsed.workerType).toBe('TECHNICIAN');
        expect(parsed.search).toBe('Kumar');
        expect(parsed.isActive).toBe(true);
      });

      it('workerInvitationFilterQuerySchema should parse valid invitation filters', () => {
        const parsed = workerInvitationFilterQuerySchema.parse({
          status: 'PENDING',
          page: '2',
        });
        expect(parsed.status).toBe('PENDING');
        expect(parsed.page).toBe(2);
      });
    });
  });

  // ==========================================================================
  // 3. Worker Middleware
  // ==========================================================================
  describe('3. Worker Middleware', () => {
    describe('requireWorkerProfile', () => {
      it('should throw UnauthorizedError when req.user is missing', async () => {
        const req: any = {};
        const res: any = {};
        let err: any = null;

        await requireWorkerProfile(req, res, (e) => {
          err = e;
        });

        expect(err).toBeInstanceOf(UnauthorizedError);
      });

      it('should throw NotFoundError when worker profile does not exist', async () => {
        const req: any = { user: { userId: noProfileUserId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireWorkerProfile(req, res, (e) => {
          err = e;
        });

        expect(err).toBeInstanceOf(NotFoundError);
        expect(err.message).toContain('Worker profile not found');
      });

      it('should attach workerProfile to request when profile exists', async () => {
        const req: any = { user: { userId: activeWorkerUserId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireWorkerProfile(req, res, (e) => {
          err = e;
        });

        expect(err).toBeUndefined();
        expect(req.workerProfile).toBeDefined();
        expect(req.workerProfile.id).toBe(activeWorkerProfileId);
        expect(req.workerProfile.approvalStatus).toBe('APPROVED');
      });

      it('should skip database lookup if req.workerProfile is already present', async () => {
        const preloadedProfile = { id: 9999n, firstName: 'Preloaded' } as any;
        const req: any = {
          user: { userId: activeWorkerUserId.toString() },
          workerProfile: preloadedProfile,
        };
        const res: any = {};
        let err: any = null;

        await requireWorkerProfile(req, res, (e) => {
          err = e;
        });

        expect(err).toBeUndefined();
        expect(req.workerProfile).toBe(preloadedProfile);
      });
    });

    describe('requireApprovedWorker', () => {
      it('should reject PENDING worker with ForbiddenError', async () => {
        const req: any = { user: { userId: pendingWorkerUserId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireApprovedWorker(req, res, (e) => {
          err = e;
        });

        expect(err).toBeInstanceOf(ForbiddenError);
        expect(err.message).toContain('Worker onboarding application is under review');
      });

      it('should reject REJECTED worker with ForbiddenError', async () => {
        const req: any = { user: { userId: rejectedWorkerUserId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireApprovedWorker(req, res, (e) => {
          err = e;
        });

        expect(err).toBeInstanceOf(ForbiddenError);
        expect(err.message).toContain('Worker application was rejected');
      });

      it('should reject SUSPENDED worker with ForbiddenError', async () => {
        const req: any = { user: { userId: suspendedWorkerUserId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireApprovedWorker(req, res, (e) => {
          err = e;
        });

        expect(err).toBeInstanceOf(ForbiddenError);
        expect(err.message).toContain('Worker account is suspended');
      });

      it('should pass for APPROVED non-suspended worker', async () => {
        const req: any = { user: { userId: activeWorkerUserId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireApprovedWorker(req, res, (e) => {
          err = e;
        });

        expect(err).toBeUndefined();
        expect(req.workerProfile).toBeDefined();
        expect(req.workerProfile.approvalStatus).toBe('APPROVED');
      });
    });

    describe('requireOperationalWorker', () => {
      it('should reject worker whose user account is BLOCKED', async () => {
        const req: any = { user: { userId: blockedUserWorkerId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireOperationalWorker(req, res, (e) => {
          err = e;
        });

        expect(err).toBeInstanceOf(ForbiddenError);
        expect(err.message).toContain("User account status is 'BLOCKED'. Account must be ACTIVE");
      });

      it('should pass for APPROVED worker whose user account is ACTIVE', async () => {
        const req: any = { user: { userId: activeWorkerUserId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireOperationalWorker(req, res, (e) => {
          err = e;
        });

        expect(err).toBeUndefined();
      });

      it('should reject PENDING worker before checking user account', async () => {
        const req: any = { user: { userId: pendingWorkerUserId.toString() } };
        const res: any = {};
        let err: any = null;

        await requireOperationalWorker(req, res, (e) => {
          err = e;
        });

        expect(err).toBeInstanceOf(ForbiddenError);
        expect(err.message).toContain('Worker onboarding application is under review');
      });
    });
  });
});
