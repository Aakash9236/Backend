import {
  DriverOnboardingService,
  validateFileMagicBytes,
  ALLOWED_DRIVER_DOCUMENT_TYPES,
  MAX_DRIVER_DOCUMENT_SIZE_BYTES,
} from '../src/modules/drivers/services/driver-onboarding.service';
import { DriverProfileRepository } from '../src/modules/drivers/repositories/driver-profile.repository';
import { DriverDocumentRepository } from '../src/modules/drivers/repositories/driver-document.repository';
import {
  DefaultDriverKycPolicyProvider,
  DriverKycValidationService,
} from '../src/modules/drivers/services/driver-kyc.service';
import { storageService } from '../src/common/services/storage.service';
import { prisma } from '../src/config/db.config';
import { BadRequestError, ForbiddenError, ConflictError, ValidationError, NotFoundError } from '../src/common/errors';

describe('Phase 6D Sub-Milestone 3.2: Driver Onboarding & Document Management Service', () => {
  let profileRepo: DriverProfileRepository;
  let documentRepo: DriverDocumentRepository;
  let kycPolicyProvider: DefaultDriverKycPolicyProvider;
  let kycValidator: DriverKycValidationService;
  let onboardingService: DriverOnboardingService;

  const TEST_USER_MOBILE = '+919988771122';
  const OTHER_USER_MOBILE = '+919988773344';

  let testUserId: bigint;
  let otherUserId: bigint;

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
    profileRepo = new DriverProfileRepository();
    documentRepo = new DriverDocumentRepository();
    kycPolicyProvider = new DefaultDriverKycPolicyProvider();
    kycValidator = new DriverKycValidationService(kycPolicyProvider, documentRepo, profileRepo);

    onboardingService = new DriverOnboardingService(
      profileRepo,
      documentRepo,
      storageService,
      kycValidator
    );

    // Clean up test data before starting
    const usersToClean = await prisma.user.findMany({
      where: { mobileNumber: { in: [TEST_USER_MOBILE, OTHER_USER_MOBILE] } },
      select: { id: true },
    });
    const userIds = usersToClean.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.driverDocument.deleteMany({ where: { driver: { userId: { in: userIds } } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    // Ensure CUSTOMER and DRIVER roles exist
    const customerRole = await prisma.role.findUnique({ where: { roleName: 'CUSTOMER' } });
    if (!customerRole) {
      await prisma.role.create({ data: { roleName: 'CUSTOMER', description: 'Customer Role' } });
    }
    const driverRole = await prisma.role.findUnique({ where: { roleName: 'DRIVER' } });
    if (!driverRole) {
      await prisma.role.create({ data: { roleName: 'DRIVER', description: 'Driver Role' } });
    }

    // Create Test User 1 (with initial CUSTOMER role)
    const user1 = await prisma.user.create({
      data: {
        mobileNumber: TEST_USER_MOBILE,
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
        mobileNumber: OTHER_USER_MOBILE,
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
      await prisma.driverDocument.deleteMany({ where: { driver: { userId: { in: userIds } } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  // ==========================================================================
  // 1. Profile Creation, Idempotency & Role Preservation
  // ==========================================================================
  describe('1. Profile Creation, Idempotency & Role Preservation', () => {
    it('should create a driver profile with DRAFT and PENDING statuses', async () => {
      const profile = await onboardingService.getOrCreateProfile(testUserId, {
        firstName: 'Ramesh',
        lastName: 'Kumar',
      });

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(testUserId.toString());
      expect(profile.firstName).toBe('Ramesh');
      expect(profile.lastName).toBe('Kumar');
      expect(profile.submissionStatus).toBe('DRAFT');
      expect(profile.approvalStatus).toBe('PENDING');
      expect(profile.isSuspended).toBe(false);
    });

    it('should be idempotent and return existing profile without creating duplicates', async () => {
      const secondCall = await onboardingService.getOrCreateProfile(testUserId, {
        firstName: 'DifferentName',
      });

      expect(secondCall).toBeDefined();
      expect(secondCall.firstName).toBe('Ramesh'); // Preserved original name

      // Verify exactly one profile in database
      const count = await prisma.driverProfile.count({ where: { userId: testUserId } });
      expect(count).toBe(1);
    });

    it('should preserve CUSTOMER role while adding DRIVER role to the user', async () => {
      const userRoles = await prisma.userRole.findMany({
        where: { userId: testUserId },
        include: { role: true },
      });

      const roleNames = userRoles.map((ur) => ur.role.roleName);
      expect(roleNames).toContain('CUSTOMER');
      expect(roleNames).toContain('DRIVER');
      expect(userRoles.length).toBeGreaterThanOrEqual(2);
    });

    it('should throw NotFoundError when attempting to onboard non-existent user', async () => {
      const fakeId = 8888888888n;
      await expect(onboardingService.getOrCreateProfile(fakeId)).rejects.toThrow(NotFoundError);
    });
  });

  // ==========================================================================
  // 2. Profile Updates & Validation
  // ==========================================================================
  describe('2. Profile Updates & Field Validation', () => {
    it('should update profile fields successfully while in DRAFT status', async () => {
      const updated = await onboardingService.updateProfile(testUserId, {
        firstName: 'Rajesh',
        lastName: 'Verma',
        dateOfBirth: '1995-05-15',
        gender: 'MALE',
        experienceYears: 5,
        licenceNumber: 'DL-MH02-2020-0012345',
        licenceClasses: ['mcwg', 'lmv'],
        issuingAuthority: 'RTO Andheri, Mumbai',
        bio: 'Professional cargo driver with 5 years experience.',
      });

      expect(updated.firstName).toBe('Rajesh');
      expect(updated.lastName).toBe('Verma');
      expect(updated.dateOfBirth).toBe('1995-05-15');
      expect(updated.gender).toBe('MALE');
      expect(updated.experienceYears).toBe(5);
      expect(updated.licenceNumber).toBe('DL-MH02-2020-0012345');
      expect(updated.licenceClasses).toEqual(['MCWG', 'LMV']); // Normalized uppercase
      expect(updated.issuingAuthority).toBe('RTO Andheri, Mumbai');
    });

    it('should reject update if driver is under 18 years of age', async () => {
      // DOB only 10 years ago
      const underAgeDob = '2016-01-01';
      await expect(
        onboardingService.updateProfile(testUserId, { dateOfBirth: underAgeDob })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject invalid experience years (negative or > 60)', async () => {
      await expect(
        onboardingService.updateProfile(testUserId, { experienceYears: -2 })
      ).rejects.toThrow(BadRequestError);

      await expect(
        onboardingService.updateProfile(testUserId, { experienceYears: 75 })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject invalid gender representations', async () => {
      await expect(
        onboardingService.updateProfile(testUserId, { gender: 'INVALID_GENDER' })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject empty or whitespace-only first names', async () => {
      await expect(
        onboardingService.updateProfile(testUserId, { firstName: '   ' })
      ).rejects.toThrow(BadRequestError);
    });
  });

  // ==========================================================================
  // 3. Document Management, MIME Magic-Bytes & Upload Security
  // ==========================================================================
  describe('3. Document Upload, MIME Magic-Bytes & Security', () => {
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

    it('should REJECT unsupported driver document types', async () => {
      await expect(
        onboardingService.uploadDocument(
          testUserId,
          { documentType: 'VEHICLE_RC' }, // Vehicle document, not driver document
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
      const largeBuffer = Buffer.alloc(MAX_DRIVER_DOCUMENT_SIZE_BYTES + 1024);
      // Give it valid PDF header
      largeBuffer.write('%PDF-1.4', 0);

      await expect(
        onboardingService.uploadDocument(
          testUserId,
          { documentType: 'DRIVING_LICENCE' },
          {
            buffer: largeBuffer,
            originalname: 'large.pdf',
            mimetype: 'application/pdf',
            size: largeBuffer.length,
          }
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('should successfully upload a valid driving licence document', async () => {
      const doc = await onboardingService.uploadDocument(
        testUserId,
        {
          documentType: 'DRIVING_LICENCE',
          expiryDate: '2030-12-31',
        },
        {
          buffer: samplePdfBuffer,
          originalname: 'my_driving_licence.pdf',
          mimetype: 'application/pdf',
          size: samplePdfBuffer.length,
        }
      );

      expect(doc).toBeDefined();
      expect(doc.documentType).toBe('DRIVING_LICENCE');
      expect(doc.verificationStatus).toBe('PENDING');
      expect(doc.expiryDate).toBe('2030-12-31');
      expect(doc.hasFile).toBe(true);
      expect(doc.isLatest).toBe(true);
      // Ensure raw storage key is NOT exposed
      expect((doc as any).documentStorageKey).toBeUndefined();
    });

    it('should successfully upload profile photo and identity proof', async () => {
      const photo = await onboardingService.uploadDocument(
        testUserId,
        { documentType: 'PROFILE_PHOTO' },
        {
          buffer: sampleJpegBuffer,
          originalname: 'driver_photo.jpg',
          mimetype: 'image/jpeg',
          size: sampleJpegBuffer.length,
        }
      );
      expect(photo.verificationStatus).toBe('PENDING');

      const idProof = await onboardingService.uploadDocument(
        testUserId,
        { documentType: 'IDENTITY_PROOF' },
        {
          buffer: samplePdfBuffer,
          originalname: 'aadhaar_card.pdf',
          mimetype: 'application/pdf',
          size: samplePdfBuffer.length,
        }
      );
      expect(idProof.verificationStatus).toBe('PENDING');
    });

    it('should safely clean up storage file if database insertion fails', async () => {
      const mockDocumentRepo = {
        create: jest.fn().mockRejectedValue(new Error('Simulated DB Constraint Failure')),
      } as unknown as DriverDocumentRepository;

      const deleteSpy = jest.spyOn(storageService, 'deleteFile');

      const serviceWithMock = new DriverOnboardingService(
        profileRepo,
        mockDocumentRepo,
        storageService,
        kycValidator
      );

      await expect(
        serviceWithMock.uploadDocument(
          testUserId,
          { documentType: 'DRIVING_LICENCE' },
          {
            buffer: samplePdfBuffer,
            originalname: 'fail.pdf',
            mimetype: 'application/pdf',
            size: samplePdfBuffer.length,
          }
        )
      ).rejects.toThrow('Simulated DB Constraint Failure');

      // Verify that deleteFile was called to prevent orphaned storage leak
      expect(deleteSpy).toHaveBeenCalled();
      deleteSpy.mockRestore();
    });
  });

  // ==========================================================================
  // 4. Document Replacement Immutability & Anti-Bypass
  // ==========================================================================
  describe('4. Document Replacement Immutability & Anti-Bypass', () => {
    it('should preserve historical documents when uploading a replacement', async () => {
      // 1. Fetch current documents for driver
      const initialDocs = await onboardingService.getDocuments(testUserId);
      const initialDlCount = initialDocs.filter((d) => d.documentType === 'DRIVING_LICENCE').length;

      // 2. Upload replacement driving licence
      const replacement = await onboardingService.uploadDocument(
        testUserId,
        {
          documentType: 'DRIVING_LICENCE',
          expiryDate: '2035-05-20',
        },
        {
          buffer: samplePdfBuffer,
          originalname: 'dl_renewed.pdf',
          mimetype: 'application/pdf',
          size: samplePdfBuffer.length,
        }
      );

      expect(replacement.verificationStatus).toBe('PENDING');

      // 3. Re-fetch all documents: count must have incremented by 1 (additive insertion)
      const updatedDocs = await onboardingService.getDocuments(testUserId);
      const updatedDlCount = updatedDocs.filter((d) => d.documentType === 'DRIVING_LICENCE').length;

      expect(updatedDlCount).toBe(initialDlCount + 1);

      // Verify that the replacement document is marked as isLatest = true
      const latestDl = updatedDocs.find((d) => d.id === replacement.id);
      expect(latestDl?.isLatest).toBe(true);

      const olderDl = updatedDocs.find((d) => d.id !== replacement.id && d.documentType === 'DRIVING_LICENCE');
      expect(olderDl?.isLatest).toBe(false);
    });

    it('should BLOCK KYC compliance when the latest replacement is PENDING (anti-bypass)', async () => {
      const profile = await onboardingService.getProfile(testUserId);
      expect(profile.kycCompliance).toBeDefined();

      // Because the latest DRIVING_LICENCE is PENDING, KYC validation must fail closed
      expect(profile.kycCompliance?.isValid).toBe(false);
      expect(profile.kycCompliance?.unverifiedTypes).toContain('DRIVING_LICENCE');
    });
  });

  // ==========================================================================
  // 5. Submission Lifecycle: DRAFT -> SUBMITTED -> REJECTED -> RESUBMITTED
  // ==========================================================================
  describe('5. Submission Lifecycle Transitions', () => {
    it('should submit profile successfully transitioning DRAFT -> SUBMITTED', async () => {
      const submitted = await onboardingService.submitProfile(testUserId);

      expect(submitted.submissionStatus).toBe('SUBMITTED');
      expect(submitted.approvalStatus).toBe('PENDING'); // Submission is NOT approval
    });

    it('should REJECT duplicate submitProfile when already SUBMITTED', async () => {
      await expect(onboardingService.submitProfile(testUserId)).rejects.toThrow(ConflictError);
    });

    it('should REJECT profile updates while SUBMITTED (under review)', async () => {
      await expect(
        onboardingService.updateProfile(testUserId, { firstName: 'HackedName' })
      ).rejects.toThrow(ConflictError);
    });

    it('should REJECT resubmitProfile when profile has not been rejected', async () => {
      // Currently SUBMITTED / PENDING, not REJECTED
      await expect(onboardingService.resubmitProfile(testUserId)).rejects.toThrow(ConflictError);
    });

    it('should support resubmission after administrative rejection', async () => {
      const driver = await profileRepo.findByUserId(testUserId);
      expect(driver).toBeDefined();

      // Simulate administrative rejection
      await profileRepo.updateApprovalStatus(
        driver!.id,
        'REJECTED',
        testUserId,
        'Licence photocopy unclear; please re-upload clear scan'
      );
      await profileRepo.updateSubmissionStatus(driver!.id, 'REJECTED');

      // Now driver updates profile and uploads clear document
      const rejectedProfile = await onboardingService.getProfile(testUserId);
      expect(rejectedProfile.submissionStatus).toBe('REJECTED');
      expect(rejectedProfile.approvalStatus).toBe('REJECTED');

      // Resubmit profile
      const resubmitted = await onboardingService.resubmitProfile(testUserId);

      expect(resubmitted.submissionStatus).toBe('SUBMITTED');
      expect(resubmitted.approvalStatus).toBe('PENDING'); // Reset to PENDING
      expect(resubmitted.rejectionReason).toBeNull(); // Cleared rejection reason
    });

    it('should NEVER allow marking a driver APPROVED from the onboarding service', async () => {
      const current = await onboardingService.getProfile(testUserId);
      expect(current.approvalStatus).not.toBe('APPROVED');
    });
  });

  // ==========================================================================
  // 6. Cross-User Tenant Isolation & Secure Streaming (IDOR Prevention)
  // ==========================================================================
  describe('6. Cross-User Tenant Isolation & Secure Streaming', () => {
    let testUserDocId: string;

    beforeAll(async () => {
      // Create profile for User 2
      await onboardingService.getOrCreateProfile(otherUserId, {
        firstName: 'Other',
        lastName: 'Driver',
      });

      const docs = await onboardingService.getDocuments(testUserId);
      expect(docs.length).toBeGreaterThan(0);
      testUserDocId = docs[0].id;
    });

    it('should ALLOW driver to stream their own document', async () => {
      const fileStream = await onboardingService.streamDocument(testUserId, testUserDocId);
      expect(fileStream).toBeDefined();
      expect(fileStream.buffer).toBeDefined();
      expect(fileStream.mimeType).toBe('application/pdf');
    });

    it('should FORBID User 2 from accessing or streaming User 1 document (IDOR block)', async () => {
      await expect(
        onboardingService.streamDocument(otherUserId, testUserDocId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when streaming a non-existent document ID', async () => {
      const fakeDocId = 9999999999n;
      await expect(
        onboardingService.streamDocument(testUserId, fakeDocId)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
