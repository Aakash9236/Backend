import {
  WorkerOnboardingService,
  validateFileMagicBytes,
  ALLOWED_WORKER_DOCUMENT_TYPES,
  MAX_WORKER_DOCUMENT_SIZE_BYTES,
} from '../src/modules/workers/services/worker-onboarding.service';
import { WorkerProfileRepository } from '../src/modules/workers/repositories/worker-profile.repository';
import { WorkerDocumentRepository } from '../src/modules/workers/repositories/worker-document.repository';
import { WorkerSkillRepository } from '../src/modules/workers/repositories/worker-skill.repository';
import {
  DefaultWorkerKycPolicyProvider,
  WorkerKycValidationService,
} from '../src/modules/workers/services/worker-kyc.service';
import { storageService } from '../src/common/services/storage.service';
import { prisma } from '../src/config/db.config';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6E Batch 2: Worker Onboarding & Document Management Service', () => {
  let profileRepo: WorkerProfileRepository;
  let documentRepo: WorkerDocumentRepository;
  let skillRepo: WorkerSkillRepository;
  let kycPolicyProvider: DefaultWorkerKycPolicyProvider;
  let kycValidator: WorkerKycValidationService;
  let onboardingService: WorkerOnboardingService;

  const TEST_WORKER_MOBILE = '+919988112233';
  const OTHER_WORKER_MOBILE = '+919988445566';

  let testUserId: bigint;
  let otherUserId: bigint;
  let testCategoryId: bigint;
  let otherCategoryId: bigint;

  // Valid sample document buffers with authentic magic bytes
  const samplePdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  const sampleJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const samplePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const sampleWebpBuffer = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBPVP8 '),
  ]);
  const spoofedFakePdfBuffer = Buffer.from('This is not a real PDF file! Plain text spoof.');

  beforeAll(async () => {
    profileRepo = new WorkerProfileRepository();
    documentRepo = new WorkerDocumentRepository();
    skillRepo = new WorkerSkillRepository();
    kycPolicyProvider = new DefaultWorkerKycPolicyProvider();
    kycValidator = new WorkerKycValidationService(kycPolicyProvider, documentRepo, profileRepo, skillRepo);

    onboardingService = new WorkerOnboardingService(
      profileRepo,
      documentRepo,
      skillRepo,
      storageService,
      kycValidator
    );

    // Clean up test data before starting
    const usersToClean = await prisma.user.findMany({
      where: { mobileNumber: { in: [TEST_WORKER_MOBILE, OTHER_WORKER_MOBILE] } },
      select: { id: true },
    });
    const userIds = usersToClean.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.workerDocument.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerSkill.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    // Ensure CUSTOMER and WORKER roles exist
    const customerRole = await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } });
    if (!customerRole) {
      await prisma.role.create({ data: { roleName: 'CUSTOMER', description: 'Customer Role' } });
    }
    const workerRole = await prisma.role.findUnique({ where: { roleName: 'WORKER' } });
    if (!workerRole) {
      await prisma.role.create({ data: { roleName: 'WORKER', description: 'Worker Role' } });
    }

    // Ensure service categories exist for testing skills
    let cat1 = await prisma.serviceCategory.findFirst({ where: { categoryCode: 'ELECTRICIAN_W6E' } });
    if (!cat1) {
      cat1 = await prisma.serviceCategory.create({
        data: {
          categoryName: 'Electrician Service W6E',
          categoryCode: 'ELECTRICIAN_W6E',
          description: 'Electrician service for test',
          isActive: true,
        },
      });
    }
    testCategoryId = cat1.id;

    let cat2 = await prisma.serviceCategory.findFirst({ where: { categoryCode: 'PLUMBER_W6E' } });
    if (!cat2) {
      cat2 = await prisma.serviceCategory.create({
        data: {
          categoryName: 'Plumber Service W6E',
          categoryCode: 'PLUMBER_W6E',
          description: 'Plumber service for test',
          isActive: true,
        },
      });
    }
    otherCategoryId = cat2.id;

    // Create Test User 1 (with initial CUSTOMER role)
    const user1 = await prisma.user.create({
      data: {
        mobileNumber: TEST_WORKER_MOBILE,
        isMobileVerified: true,
      },
    });
    testUserId = user1.id;

    const custRole = await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } });
    if (custRole) {
      await prisma.userRole.create({
        data: { userId: testUserId, roleId: custRole.id },
      });
    }

    // Create Test User 2
    const user2 = await prisma.user.create({
      data: {
        mobileNumber: OTHER_WORKER_MOBILE,
        isMobileVerified: true,
      },
    });
    otherUserId = user2.id;
    if (custRole) {
      await prisma.userRole.create({
        data: { userId: otherUserId, roleId: custRole.id },
      });
    }
  });

  afterAll(async () => {
    // Clean up test records
    const userIds = [testUserId, otherUserId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.workerDocument.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerSkill.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    // Clean up test service categories
    await prisma.serviceCategory.deleteMany({
      where: { categoryCode: { in: ['ELECTRICIAN_W6E', 'PLUMBER_W6E'] } },
    });
  });

  // ==========================================================================
  // 1. Profile Creation, Idempotency & Role Preservation
  // ==========================================================================
  describe('1. Profile Creation, Idempotency & Role Preservation', () => {
    it('should create a worker profile with DRAFT and PENDING statuses', async () => {
      const profile = await onboardingService.getOrCreateProfile(testUserId, {
        firstName: 'Amit',
        lastName: 'Sharma',
        workerType: 'TECHNICIAN',
      });

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(testUserId.toString());
      expect(profile.firstName).toBe('Amit');
      expect(profile.lastName).toBe('Sharma');
      expect(profile.workerType).toBe('TECHNICIAN');
      expect(profile.submissionStatus).toBe('DRAFT');
      expect(profile.approvalStatus).toBe('PENDING');
      expect(profile.isSuspended).toBe(false);
    });

    it('should be idempotent and return existing profile without creating duplicates', async () => {
      const secondCall = await onboardingService.getOrCreateProfile(testUserId, {
        firstName: 'DifferentName',
      });

      expect(secondCall).toBeDefined();
      expect(secondCall.firstName).toBe('Amit'); // Preserved original name

      // Verify exactly one profile in database
      const count = await prisma.workerProfile.count({ where: { userId: testUserId } });
      expect(count).toBe(1);
    });

    it('should preserve CUSTOMER role while adding WORKER role to the user', async () => {
      const userRoles = await prisma.userRole.findMany({
        where: { userId: testUserId },
        include: { role: true },
      });

      const roleNames = userRoles.map((ur) => ur.role.roleName);
      expect(roleNames).toContain('CUSTOMER');
      expect(roleNames).toContain('WORKER');
      expect(userRoles.length).toBeGreaterThanOrEqual(2);
    });

    it('should throw NotFoundError when attempting to onboard non-existent user', async () => {
      const fakeId = 8888888888n;
      await expect(onboardingService.getOrCreateProfile(fakeId)).rejects.toThrow(NotFoundError);
    });
  });

  // ==========================================================================
  // 2. Profile Updates & Field Validation
  // ==========================================================================
  describe('2. Profile Updates & Field Validation', () => {
    it('should update profile fields successfully while in DRAFT status', async () => {
      const updated = await onboardingService.updateMyProfile(testUserId, {
        firstName: 'Amit',
        lastName: 'Verma',
        dateOfBirth: '1992-04-10',
        gender: 'MALE',
        experienceYears: 4,
        workerType: 'TECHNICIAN',
        bio: 'Certified technician with 4 years experience.',
      });

      expect(updated.firstName).toBe('Amit');
      expect(updated.lastName).toBe('Verma');
      expect(updated.dateOfBirth).toBe('1992-04-10');
      expect(updated.gender).toBe('MALE');
      expect(updated.experienceYears).toBe(4);
      expect(updated.workerType).toBe('TECHNICIAN');
    });

    it('should reject update if worker is under 18 years of age', async () => {
      const underAgeDob = '2016-01-01';
      await expect(
        onboardingService.updateMyProfile(testUserId, { dateOfBirth: underAgeDob })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject invalid experience years (negative or > 60)', async () => {
      await expect(
        onboardingService.updateMyProfile(testUserId, { experienceYears: -1 })
      ).rejects.toThrow(BadRequestError);

      await expect(
        onboardingService.updateMyProfile(testUserId, { experienceYears: 70 })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject invalid workerType representations', async () => {
      await expect(
        onboardingService.updateMyProfile(testUserId, { workerType: 'INVALID_TYPE' as any })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject invalid gender representations', async () => {
      await expect(
        onboardingService.updateMyProfile(testUserId, { gender: 'INVALID_GENDER' })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject empty or whitespace-only first names', async () => {
      await expect(
        onboardingService.updateMyProfile(testUserId, { firstName: '   ' })
      ).rejects.toThrow(BadRequestError);
    });
  });

  // ==========================================================================
  // 3. Skills and Qualifications Management
  // ==========================================================================
  describe('3. Skills and Qualifications Management', () => {
    let createdSkillId: string;

    it('should add a skill qualification linked to a valid service category', async () => {
      const skill = await onboardingService.addSkill(testUserId, {
        serviceCategoryId: testCategoryId,
        experienceYears: 3,
      });

      expect(skill).toBeDefined();
      expect(skill.serviceCategoryId).toBe(testCategoryId.toString());
      expect(skill.experienceYears).toBe(3);
      expect(skill.verificationStatus).toBe('PENDING'); // Default status
      expect(skill.isActive).toBe(true);

      createdSkillId = skill.id;
    });

    it('should prevent adding duplicate skill for same service category', async () => {
      await expect(
        onboardingService.addSkill(testUserId, {
          serviceCategoryId: testCategoryId,
          experienceYears: 1,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should throw NotFoundError when adding skill with non-existent category', async () => {
      await expect(
        onboardingService.addSkill(testUserId, {
          serviceCategoryId: 999999999n,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should list all skills registered for worker', async () => {
      const skills = await onboardingService.listMySkills(testUserId);
      expect(skills.length).toBeGreaterThanOrEqual(1);
      expect(skills.some((s) => s.id === createdSkillId)).toBe(true);
    });

    it('should prevent User 2 from deleting User 1 skill (IDOR protection)', async () => {
      // First ensure User 2 has a profile
      await onboardingService.getOrCreateProfile(otherUserId, {
        firstName: 'Other',
        workerType: 'HELPER',
      });

      await expect(
        onboardingService.removeSkill(otherUserId, createdSkillId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow worker to remove their own skill', async () => {
      // Add second skill to delete
      const skill2 = await onboardingService.addSkill(testUserId, {
        serviceCategoryId: otherCategoryId,
        experienceYears: 2,
      });

      const res = await onboardingService.removeSkill(testUserId, skill2.id);
      expect(res.success).toBe(true);

      // Verify removed
      const skillsAfter = await onboardingService.listMySkills(testUserId);
      expect(skillsAfter.some((s) => s.id === skill2.id)).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Document Upload, MIME Magic-Bytes & Security
  // ==========================================================================
  describe('4. Document Upload, MIME Magic-Bytes & Security', () => {
    it('should validate authentic PDF magic bytes successfully', () => {
      const mime = validateFileMagicBytes(samplePdfBuffer, 'application/pdf');
      expect(mime).toBe('application/pdf');
    });

    it('should validate authentic JPEG magic bytes successfully', () => {
      const mime = validateFileMagicBytes(sampleJpegBuffer, 'image/jpeg');
      expect(mime).toBe('image/jpeg');
    });

    it('should validate authentic PNG magic bytes successfully', () => {
      const mime = validateFileMagicBytes(samplePngBuffer, 'image/png');
      expect(mime).toBe('image/png');
    });

    it('should validate authentic WEBP magic bytes successfully', () => {
      const mime = validateFileMagicBytes(sampleWebpBuffer, 'image/webp');
      expect(mime).toBe('image/webp');
    });

    it('should REJECT spoofed file disguised as PDF (MIME spoofing prevention)', () => {
      expect(() => {
        validateFileMagicBytes(spoofedFakePdfBuffer, 'application/pdf');
      }).toThrow(BadRequestError);
    });

    it('should REJECT MIME type mismatch (declared PNG but content is PDF)', () => {
      expect(() => {
        validateFileMagicBytes(samplePdfBuffer, 'image/png');
      }).toThrow(BadRequestError);
    });

    it('should REJECT unsupported worker document types', async () => {
      await expect(
        onboardingService.uploadDocument(
          testUserId,
          { documentType: 'VEHICLE_RC' },
          {
            buffer: samplePdfBuffer,
            originalname: 'rc.pdf',
            mimetype: 'application/pdf',
            size: samplePdfBuffer.length,
          }
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('should REJECT oversized files exceeding 5MB limit', async () => {
      const largeBuffer = Buffer.alloc(MAX_WORKER_DOCUMENT_SIZE_BYTES + 1024);
      largeBuffer.write('%PDF-1.4', 0);

      await expect(
        onboardingService.uploadDocument(
          testUserId,
          { documentType: 'IDENTITY_PROOF' },
          {
            buffer: largeBuffer,
            originalname: 'large.pdf',
            mimetype: 'application/pdf',
            size: largeBuffer.length,
          }
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('should successfully upload identity proof, photo, skill certificate, and police verification', async () => {
      const idDoc = await onboardingService.uploadDocument(
        testUserId,
        { documentType: 'IDENTITY_PROOF', expiryDate: '2032-12-31' },
        {
          buffer: samplePdfBuffer,
          originalname: 'aadhaar.pdf',
          mimetype: 'application/pdf',
          size: samplePdfBuffer.length,
        }
      );
      expect(idDoc.documentType).toBe('IDENTITY_PROOF');
      expect(idDoc.verificationStatus).toBe('PENDING');
      expect(idDoc.isLatest).toBe(true);

      const photoDoc = await onboardingService.uploadDocument(
        testUserId,
        { documentType: 'PROFILE_PHOTO' },
        {
          buffer: sampleJpegBuffer,
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: sampleJpegBuffer.length,
        }
      );
      expect(photoDoc.documentType).toBe('PROFILE_PHOTO');

      const certDoc = await onboardingService.uploadDocument(
        testUserId,
        { documentType: 'SKILL_CERTIFICATE' },
        {
          buffer: samplePdfBuffer,
          originalname: 'certificate.pdf',
          mimetype: 'application/pdf',
          size: samplePdfBuffer.length,
        }
      );
      expect(certDoc.documentType).toBe('SKILL_CERTIFICATE');

      const policeDoc = await onboardingService.uploadDocument(
        testUserId,
        { documentType: 'POLICE_VERIFICATION', expiryDate: '2028-06-30' },
        {
          buffer: samplePdfBuffer,
          originalname: 'police.pdf',
          mimetype: 'application/pdf',
          size: samplePdfBuffer.length,
        }
      );
      expect(policeDoc.documentType).toBe('POLICE_VERIFICATION');
    });

    it('should safely clean up storage file if database insertion fails', async () => {
      const mockDocumentRepo = {
        create: jest.fn().mockRejectedValue(new Error('Simulated DB Insertion Error')),
      } as unknown as WorkerDocumentRepository;

      const deleteSpy = jest.spyOn(storageService, 'deleteFile');

      const serviceWithMock = new WorkerOnboardingService(
        profileRepo,
        mockDocumentRepo,
        skillRepo,
        storageService,
        kycValidator
      );

      await expect(
        serviceWithMock.uploadDocument(
          testUserId,
          { documentType: 'IDENTITY_PROOF' },
          {
            buffer: samplePdfBuffer,
            originalname: 'fail.pdf',
            mimetype: 'application/pdf',
            size: samplePdfBuffer.length,
          }
        )
      ).rejects.toThrow('Simulated DB Insertion Error');

      expect(deleteSpy).toHaveBeenCalled();
      deleteSpy.mockRestore();
    });

    it('should preserve historical documents when uploading a replacement (additive history)', async () => {
      const initialDocs = await onboardingService.listMyDocuments(testUserId);
      const initialIdCount = initialDocs.filter((d) => d.documentType === 'IDENTITY_PROOF').length;

      const replacement = await onboardingService.uploadDocument(
        testUserId,
        {
          documentType: 'IDENTITY_PROOF',
          expiryDate: '2035-01-01',
        },
        {
          buffer: samplePdfBuffer,
          originalname: 'new_aadhaar.pdf',
          mimetype: 'application/pdf',
          size: samplePdfBuffer.length,
        }
      );

      expect(replacement.verificationStatus).toBe('PENDING');

      const updatedDocs = await onboardingService.listMyDocuments(testUserId);
      const updatedIdCount = updatedDocs.filter((d) => d.documentType === 'IDENTITY_PROOF').length;
      expect(updatedIdCount).toBe(initialIdCount + 1);

      const latestDoc = updatedDocs.find((d) => d.id === replacement.id);
      expect(latestDoc?.isLatest).toBe(true);

      const olderDoc = updatedDocs.find((d) => d.id !== replacement.id && d.documentType === 'IDENTITY_PROOF');
      expect(olderDoc?.isLatest).toBe(false);
    });
  });

  // ==========================================================================
  // 5. Submission Lifecycle & Pre-Submission Validation
  // ==========================================================================
  describe('5. Submission Lifecycle Transitions', () => {
    it('should submit profile successfully transitioning DRAFT -> SUBMITTED', async () => {
      const submitted = await onboardingService.submitOnboarding(testUserId);

      expect(submitted.submissionStatus).toBe('SUBMITTED');
      expect(submitted.approvalStatus).toBe('PENDING'); // Submission NEVER auto-approves
    });

    it('should REJECT duplicate submitOnboarding when already SUBMITTED', async () => {
      await expect(onboardingService.submitOnboarding(testUserId)).rejects.toThrow(ConflictError);
    });

    it('should REJECT profile updates while SUBMITTED (under review)', async () => {
      await expect(
        onboardingService.updateMyProfile(testUserId, { firstName: 'HackedName' })
      ).rejects.toThrow(ConflictError);
    });

    it('should REJECT resubmitOnboarding when profile is not rejected or action-required', async () => {
      await expect(onboardingService.resubmitOnboarding(testUserId)).rejects.toThrow(ConflictError);
    });

    it('should support resubmission after administrative rejection', async () => {
      const worker = await profileRepo.findByUserId(testUserId);
      expect(worker).toBeDefined();

      // Simulate administrative rejection
      await profileRepo.updateApprovalStatus(
        worker!.id,
        'REJECTED',
        testUserId,
        'Certificate scanned at low resolution'
      );
      await profileRepo.updateSubmissionStatus(worker!.id, 'REJECTED');

      const rejectedProfile = await onboardingService.getMyProfile(testUserId);
      expect(rejectedProfile.submissionStatus).toBe('REJECTED');
      expect(rejectedProfile.approvalStatus).toBe('REJECTED');

      // Resubmit profile
      const resubmitted = await onboardingService.resubmitOnboarding(testUserId);

      expect(resubmitted.submissionStatus).toBe('SUBMITTED');
      expect(resubmitted.approvalStatus).toBe('PENDING'); // Reset to PENDING
      expect(resubmitted.rejectionReason).toBeNull();
    });

    it('should return operational status isOperational = false while pending', async () => {
      const status = await onboardingService.getOnboardingStatus(testUserId);
      expect(status.submissionStatus).toBe('SUBMITTED');
      expect(status.approvalStatus).toBe('PENDING');
      expect(status.isOperational).toBe(false);
    });
  });

  // ==========================================================================
  // 6. Cross-User Tenant Isolation & Secure Streaming (IDOR Protection)
  // ==========================================================================
  describe('6. Cross-User Tenant Isolation & Secure Streaming', () => {
    let testDocId: string;

    beforeAll(async () => {
      const docs = await onboardingService.listMyDocuments(testUserId);
      expect(docs.length).toBeGreaterThan(0);
      testDocId = docs[0].id;
    });

    it('should ALLOW worker to stream their own document', async () => {
      const stream = await onboardingService.streamMyDocument(testUserId, testDocId);
      expect(stream).toBeDefined();
      expect(stream.buffer).toBeDefined();
      expect(stream.mimeType).toBe('application/pdf');
    });

    it('should FORBID User 2 from streaming User 1 document (IDOR block)', async () => {
      await expect(
        onboardingService.streamMyDocument(otherUserId, testDocId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should FORBID User 2 from getting status of User 1 document (IDOR block)', async () => {
      await expect(
        onboardingService.getDocumentStatus(otherUserId, testDocId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when streaming a non-existent document ID', async () => {
      const fakeId = 9999999999n;
      await expect(
        onboardingService.streamMyDocument(testUserId, fakeId)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
