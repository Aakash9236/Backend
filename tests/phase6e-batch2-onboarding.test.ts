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

  const TEST_WORKER_MOBILE = '+919988001122';
  const OTHER_WORKER_MOBILE = '+919988003344';

  let testUserId: bigint;
  let otherUserId: bigint;
  let cleaningCategoryId: bigint;
  let plumbingCategoryId: bigint;

  // Authentic test file buffers
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
    kycValidator = new WorkerKycValidationService(
      kycPolicyProvider,
      documentRepo,
      skillRepo,
      profileRepo
    );

    onboardingService = new WorkerOnboardingService(
      profileRepo,
      documentRepo,
      skillRepo,
      storageService,
      kycValidator
    );

    // Clean up existing test data
    const existingUsers = await prisma.user.findMany({
      where: { mobileNumber: { in: [TEST_WORKER_MOBILE, OTHER_WORKER_MOBILE] } },
      select: { id: true },
    });
    const userIds = existingUsers.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.workerDocument.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerSkill.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerAvailability.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerPartnerAffiliation.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    // Ensure required roles exist
    for (const rName of ['CUSTOMER', 'PARTNER', 'WORKER']) {
      const role = await prisma.role.findUnique({ where: { roleName: rName } });
      if (!role) {
        await prisma.role.create({ data: { roleName: rName, description: `${rName} Role` } });
      }
    }

    // Ensure test service categories exist
    let cleaningCat = await prisma.serviceCategory.findUnique({ where: { categoryCode: 'CLEANING' } });
    if (!cleaningCat) {
      cleaningCat = await prisma.serviceCategory.create({
        data: {
          categoryName: 'Home Cleaning',
          categoryCode: 'CLEANING',
          isActive: true,
        },
      });
    }
    cleaningCategoryId = cleaningCat.id;

    let plumbingCat = await prisma.serviceCategory.findUnique({ where: { categoryCode: 'PLUMBING' } });
    if (!plumbingCat) {
      plumbingCat = await prisma.serviceCategory.create({
        data: {
          categoryName: 'Plumbing Services',
          categoryCode: 'PLUMBING',
          isActive: true,
        },
      });
    }
    plumbingCategoryId = plumbingCat.id;

    // Create Test User 1 with CUSTOMER and PARTNER roles
    const user1 = await prisma.user.create({
      data: {
        mobileNumber: TEST_WORKER_MOBILE,
        isMobileVerified: true,
      },
    });
    testUserId = user1.id;

    const custRole = await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } });
    const partnerRole = await prisma.role.findUnique({ where: { roleName: 'PARTNER' } });
    if (custRole) {
      await prisma.userRole.create({ data: { userId: testUserId, roleId: custRole.id } });
    }
    if (partnerRole) {
      await prisma.userRole.create({ data: { userId: testUserId, roleId: partnerRole.id } });
    }

    // Create Test User 2
    const user2 = await prisma.user.create({
      data: {
        mobileNumber: OTHER_WORKER_MOBILE,
        isMobileVerified: true,
      },
    });
    otherUserId = user2.id;
  });

  afterAll(async () => {
    const usersToClean = await prisma.user.findMany({
      where: { mobileNumber: { in: [TEST_WORKER_MOBILE, OTHER_WORKER_MOBILE] } },
      select: { id: true },
    });
    const userIds = usersToClean.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.workerDocument.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerSkill.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerAvailability.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerPartnerAffiliation.deleteMany({ where: { worker: { userId: { in: userIds } } } });
      await prisma.workerProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  // ==========================================================================
  // 1. Worker Profile Lifecycle & Role Preservation
  // ==========================================================================
  describe('1. Worker Profile Lifecycle & Role Preservation', () => {
    it('should create independent worker profile and preserve existing CUSTOMER & PARTNER roles', async () => {
      const profile = await onboardingService.getOrCreateProfile(testUserId, {
        firstName: 'Ramesh',
        lastName: 'Kumar',
        workerType: 'TECHNICIAN',
        experienceYears: 3,
      });

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(testUserId.toString());
      expect(profile.firstName).toBe('Ramesh');
      expect(profile.lastName).toBe('Kumar');
      expect(profile.workerType).toBe('TECHNICIAN');
      expect(profile.experienceYears).toBe(3);
      expect(profile.submissionStatus).toBe('DRAFT');
      expect(profile.approvalStatus).toBe('PENDING'); // Not approved automatically!

      // Verify roles preservation: CUSTOMER, PARTNER preserved, WORKER added
      expect(profile.roles).toContain('CUSTOMER');
      expect(profile.roles).toContain('PARTNER');
      expect(profile.roles).toContain('WORKER');
    });

    it('should be idempotent: calling getOrCreateProfile again returns existing profile', async () => {
      const existing = await onboardingService.getOrCreateProfile(testUserId);
      expect(existing.firstName).toBe('Ramesh');
      expect(existing.workerType).toBe('TECHNICIAN');
    });

    it('should update draft profile fields successfully', async () => {
      const updated = await onboardingService.updateMyProfile(testUserId, {
        firstName: 'Rameshwar',
        bio: 'Certified master electrician and plumber with 5 years experience.',
        dateOfBirth: '1992-05-15',
        gender: 'MALE',
        experienceYears: 5,
      });

      expect(updated.firstName).toBe('Rameshwar');
      expect(updated.bio).toBe('Certified master electrician and plumber with 5 years experience.');
      expect(updated.dateOfBirth).toBe('1992-05-15');
      expect(updated.gender).toBe('MALE');
      expect(updated.experienceYears).toBe(5);
    });

    it('should reject dateOfBirth for underage worker (< 18 years old)', async () => {
      await expect(
        onboardingService.updateMyProfile(testUserId, {
          dateOfBirth: '2015-01-01', // Underage
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject invalid worker type', async () => {
      await expect(
        onboardingService.updateMyProfile(testUserId, {
          workerType: 'SUPERHERO',
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should return onboarding status overview', async () => {
      const status = await onboardingService.getOnboardingStatus(testUserId);
      expect(status.submissionStatus).toBe('DRAFT');
      expect(status.approvalStatus).toBe('PENDING');
      expect(status.isReadyForSubmission).toBe(true);
      expect(status.documentsSummary).toBeDefined();
      expect(status.skillsSummary).toBeDefined();
      expect(status.kycCompliance).toBeDefined();
    });
  });

  // ==========================================================================
  // 2. Document Upload, Magic-Bytes & Security
  // ==========================================================================
  describe('2. Document Management & Magic-Byte Security', () => {
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

    it('should reject spoofed file content where MIME declared does not match binary magic bytes', () => {
      expect(() => {
        validateFileMagicBytes(spoofedFakePdfBuffer, 'application/pdf');
      }).toThrow(BadRequestError);
    });

    it('should reject oversized file upload (> 5MB)', async () => {
      const oversizedFile = {
        buffer: samplePdfBuffer,
        originalname: 'big.pdf',
        mimetype: 'application/pdf',
        size: MAX_WORKER_DOCUMENT_SIZE_BYTES + 1024,
      };

      await expect(
        onboardingService.uploadDocument(testUserId, { documentType: 'IDENTITY_PROOF' }, oversizedFile)
      ).rejects.toThrow(BadRequestError);
    });

    it('should upload valid worker document to private storage and create DB record', async () => {
      const file = {
        buffer: samplePdfBuffer,
        originalname: 'aadhaar_card.pdf',
        mimetype: 'application/pdf',
        size: samplePdfBuffer.length,
      };

      const doc = await onboardingService.uploadDocument(
        testUserId,
        {
          documentType: 'IDENTITY_PROOF',
          expiryDate: '2030-12-31',
        },
        file
      );

      expect(doc).toBeDefined();
      expect(doc.documentType).toBe('IDENTITY_PROOF');
      expect(doc.verificationStatus).toBe('PENDING');
      expect(doc.isLatest).toBe(true);
      expect(doc.hasFile).toBe(true);
      // Zero path disclosure
      expect((doc as any).documentStorageKey).toBeUndefined();
    });

    it('should support ADDITIVE replacement of document without overwriting previous history', async () => {
      const newFile = {
        buffer: sampleJpegBuffer,
        originalname: 'aadhaar_updated.jpg',
        mimetype: 'image/jpeg',
        size: sampleJpegBuffer.length,
      };

      const replacementDoc = await onboardingService.replaceDocument(
        testUserId,
        {
          documentType: 'IDENTITY_PROOF',
          expiryDate: '2032-12-31',
        },
        newFile
      );

      expect(replacementDoc).toBeDefined();
      expect(replacementDoc.verificationStatus).toBe('PENDING');

      // Check all documents for this worker: both must exist!
      const docs = await onboardingService.listMyDocuments(testUserId);
      const identityDocs = docs.filter((d) => d.documentType === 'IDENTITY_PROOF');
      expect(identityDocs.length).toBeGreaterThanOrEqual(2);

      // Latest document must be the replacement
      const latestDoc = identityDocs.find((d) => d.isLatest === true);
      expect(latestDoc).toBeDefined();
      expect(latestDoc?.id).toBe(replacementDoc.id);
    });

    it('should securely stream worker document and enforce IDOR protection against cross-worker access', async () => {
      // Create second worker profile for otherUserId
      await onboardingService.getOrCreateProfile(otherUserId, {
        firstName: 'Suresh',
      });

      const docs = await onboardingService.listMyDocuments(testUserId);
      const targetDoc = docs[0];

      // Worker 1 can stream their own document
      const stream = await onboardingService.streamMyDocument(testUserId, targetDoc.id);
      expect(stream.buffer).toBeDefined();
      expect(stream.mimeType).toBeDefined();

      // Worker 2 attempting to stream Worker 1's document must be blocked (IDOR protection)
      await expect(
        onboardingService.streamMyDocument(otherUserId, targetDoc.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ==========================================================================
  // 3. Skills & Qualifications Management
  // ==========================================================================
  describe('3. Skills & Qualifications Management', () => {
    it('should add a service category skill in PENDING status', async () => {
      const skill = await onboardingService.addSkill(testUserId, {
        serviceCategoryId: cleaningCategoryId,
        experienceYears: 4,
      });

      expect(skill).toBeDefined();
      expect(skill.serviceCategoryId).toBe(cleaningCategoryId.toString());
      expect(skill.serviceCategoryCode).toBe('CLEANING');
      expect(skill.experienceYears).toBe(4);
      expect(skill.verificationStatus).toBe('PENDING');
      expect(skill.isActive).toBe(true);
    });

    it('should reject duplicate active skill for the same worker and category', async () => {
      await expect(
        onboardingService.addSkill(testUserId, {
          serviceCategoryId: cleaningCategoryId,
          experienceYears: 2,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should reject adding a skill with invalid or non-existent service category', async () => {
      await expect(
        onboardingService.addSkill(testUserId, {
          serviceCategoryId: 99999999n,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should list all skills for authenticated worker', async () => {
      const skills = await onboardingService.listMySkills(testUserId);
      expect(skills.length).toBeGreaterThanOrEqual(1);
      expect(skills.some((s) => s.serviceCategoryCode === 'CLEANING')).toBe(true);
    });

    it('should allow removing a skill in draft lifecycle', async () => {
      // Add plumbing skill
      const plumbingSkill = await onboardingService.addSkill(testUserId, {
        serviceCategoryId: plumbingCategoryId,
        experienceYears: 2,
      });

      // Remove it
      const res = await onboardingService.removeSkill(testUserId, plumbingSkill.id);
      expect(res.success).toBe(true);

      // Verify removal
      const skillsAfter = await onboardingService.listMySkills(testUserId);
      expect(skillsAfter.some((s) => s.id === plumbingSkill.id)).toBe(false);
    });

    it('should block removing another worker skill (IDOR protection)', async () => {
      const skills = await onboardingService.listMySkills(testUserId);
      const worker1Skill = skills[0];

      await expect(
        onboardingService.removeSkill(otherUserId, worker1Skill.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ==========================================================================
  // 4. Submission & Resubmission Lifecycle
  // ==========================================================================
  describe('4. Submission & Resubmission Lifecycle', () => {
    it('should block submission if mandatory KYC documents are missing', async () => {
      // Worker 2 has no documents uploaded
      await expect(
        onboardingService.submitOnboarding(otherUserId)
      ).rejects.toThrow(ValidationError);
    });

    it('should submit onboarding when profile is complete and transition status to SUBMITTED', async () => {
      // Give Worker 2 a complete profile and verified document
      await onboardingService.updateMyProfile(otherUserId, {
        firstName: 'Suresh',
        dateOfBirth: '1990-01-01',
        workerType: 'HELPER',
      });

      const file = {
        buffer: samplePdfBuffer,
        originalname: 'id_proof.pdf',
        mimetype: 'application/pdf',
        size: samplePdfBuffer.length,
      };

      const doc = await onboardingService.uploadDocument(
        otherUserId,
        { documentType: 'IDENTITY_PROOF' },
        file
      );

      // Simulate admin verification of the document
      await prisma.workerDocument.update({
        where: { id: BigInt(doc.id) },
        data: { verificationStatus: 'VERIFIED' },
      });

      const submitted = await onboardingService.submitOnboarding(otherUserId);
      expect(submitted.submissionStatus).toBe('SUBMITTED');
      expect(submitted.approvalStatus).toBe('PENDING'); // Onboarding does NOT approve!
    });

    it('LIFECYCLE LOCK: should block profile modifications while SUBMITTED (under review)', async () => {
      await expect(
        onboardingService.updateMyProfile(otherUserId, {
          firstName: 'Suresh Updated',
        })
      ).rejects.toThrow(ConflictError);
    });

    it('LIFECYCLE LOCK: should block duplicate submission while already SUBMITTED', async () => {
      await expect(
        onboardingService.submitOnboarding(otherUserId)
      ).rejects.toThrow(ConflictError);
    });

    it('should support controlled resubmission when rejected', async () => {
      // Simulate admin rejection
      const profile = await profileRepo.findByUserId(otherUserId);
      await prisma.workerProfile.update({
        where: { id: profile!.id },
        data: {
          submissionStatus: 'REJECTED',
          approvalStatus: 'REJECTED',
          rejectionReason: 'Please re-upload clearer identity document.',
        },
      });

      // Now resubmit
      const resubmitted = await onboardingService.resubmitOnboarding(otherUserId);
      expect(resubmitted.submissionStatus).toBe('SUBMITTED');
      expect(resubmitted.approvalStatus).toBe('PENDING');
      expect(resubmitted.rejectionReason).toBeNull(); // Cleared on resubmission
    });
  });
});
