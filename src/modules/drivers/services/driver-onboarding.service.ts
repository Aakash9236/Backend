import { Prisma, DriverProfile, DriverDocument } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from '../../../common/errors';
import { DateUtil } from '../../../common/utils/date.util';
import { IStorageService, storageService } from '../../../common/services/storage.service';
import { DriverProfileRepository } from '../repositories/driver-profile.repository';
import { DriverDocumentRepository } from '../repositories/driver-document.repository';
import {
  DriverKycValidationService,
  driverKycValidationService,
  DriverKycValidationResult,
  DriverKycPolicyParams,
} from './driver-kyc.service';
import {
  CreateDriverProfileData,
  UpdateDriverProfileData,
} from '../drivers.types';

// ============================================================================
// Constants & Allowed Types
// ============================================================================

export const ALLOWED_DRIVER_DOCUMENT_TYPES = [
  'DRIVING_LICENCE',
  'IDENTITY_PROOF',
  'PROFILE_PHOTO',
  'COMMERCIAL_BADGE',
  'POLICE_VERIFICATION',
  'MEDICAL_FITNESS',
  'OTHER',
] as const;

export type DriverDocumentType = (typeof ALLOWED_DRIVER_DOCUMENT_TYPES)[number];

export const MAX_DRIVER_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const APPROVED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

// ============================================================================
// Helper: Magic Bytes Validation
// ============================================================================

/**
 * Validates file buffer magic bytes against approved document formats.
 * Detects and blocks MIME spoofing (e.g. an executable or script disguised with a .pdf extension).
 */
export function validateFileMagicBytes(buffer: Buffer, declaredMimeType: string): string {
  if (!buffer || buffer.length < 4) {
    throw new BadRequestError('Corrupted or empty file buffer.');
  }

  const normalizedDeclared = declaredMimeType.trim().toLowerCase();

  // 1. PDF: starts with '%PDF' (0x25 0x50 0x44 0x46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    if (normalizedDeclared !== 'application/pdf') {
      throw new BadRequestError(
        `File signature mismatch: Content is a PDF document, but declared MIME is '${declaredMimeType}'.`
      );
    }
    return 'application/pdf';
  }

  // 2. JPEG: starts with 0xFF 0xD8 0xFF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    if (normalizedDeclared !== 'image/jpeg' && normalizedDeclared !== 'image/jpg') {
      throw new BadRequestError(
        `File signature mismatch: Content is a JPEG image, but declared MIME is '${declaredMimeType}'.`
      );
    }
    return 'image/jpeg';
  }

  // 3. PNG: starts with 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (normalizedDeclared !== 'image/png') {
      throw new BadRequestError(
        `File signature mismatch: Content is a PNG image, but declared MIME is '${declaredMimeType}'.`
      );
    }
    return 'image/png';
  }

  // 4. WEBP: 'RIFF' at offset 0 and 'WEBP' at offset 8
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    if (normalizedDeclared !== 'image/webp') {
      throw new BadRequestError(
        `File signature mismatch: Content is a WEBP image, but declared MIME is '${declaredMimeType}'.`
      );
    }
    return 'image/webp';
  }

  const hexHeader = buffer.subarray(0, 4).toString('hex');
  throw new BadRequestError(
    `Unsupported or spoofed file content signature (header: ${hexHeader}). Only PDF, JPEG, PNG, and WEBP documents are permitted.`
  );
}

// ============================================================================
// Service Input & Output Types
// ============================================================================

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadDriverDocumentInput {
  documentType: string;
  expiryDate?: Date | string | null;
  documentMetadata?: Record<string, any>;
}

export interface UpdateDriverProfileInput {
  firstName?: string;
  lastName?: string | null;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  bio?: string | null;
  experienceYears?: number;
  licenceNumber?: string | null;
  licenceClasses?: string[];
  licenceExpiryDate?: Date | string | null;
  issuingAuthority?: string | null;
  profileImageUrl?: string | null;
}

export interface DriverProfileResponse {
  id: string;
  userId: string;
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  profileImageUrl: string | null;
  bio: string | null;
  experienceYears: number;
  licenceNumber: string | null;
  licenceClasses: string[];
  licenceExpiryDate: string | null;
  issuingAuthority: string | null;
  submissionStatus: string;
  approvalStatus: string;
  isSuspended: boolean;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  roles?: string[];
  kycCompliance?: DriverKycValidationResult;
}

export interface DriverDocumentResponse {
  id: string;
  driverId: string;
  documentType: string;
  verificationStatus: string;
  rejectionReason: string | null;
  expiryDate: string | null;
  uploadedAt: string;
  isLatest?: boolean;
  isExpired?: boolean;
  isExpiringSoon?: boolean;
  daysRemaining?: number;
  hasFile: boolean;
}

// ============================================================================
// Driver Onboarding & Document Management Service
// ============================================================================

export class DriverOnboardingService {
  constructor(
    private profileRepo: DriverProfileRepository = new DriverProfileRepository(),
    private documentRepo: DriverDocumentRepository = new DriverDocumentRepository(),
    private storage: IStorageService = storageService,
    private kycValidator: DriverKycValidationService = driverKycValidationService
  ) {}

  /**
   * Serializes a DriverProfile into an API-safe response, stripping sensitive internals.
   */
  private serializeProfile(
    profile: DriverProfile,
    roles?: string[],
    kycCompliance?: DriverKycValidationResult
  ): DriverProfileResponse {
    return {
      id: profile.id.toString(),
      userId: profile.userId.toString(),
      firstName: profile.firstName,
      lastName: profile.lastName,
      dateOfBirth: profile.dateOfBirth
        ? DateUtil.parseCalendarDate(profile.dateOfBirth).dateStr
        : null,
      gender: profile.gender,
      profileImageUrl: profile.profileImageUrl,
      bio: profile.bio,
      experienceYears: profile.experienceYears,
      licenceNumber: profile.licenceNumber,
      licenceClasses: profile.licenceClasses || [],
      licenceExpiryDate: profile.licenceExpiryDate
        ? DateUtil.parseCalendarDate(profile.licenceExpiryDate).dateStr
        : null,
      issuingAuthority: profile.issuingAuthority,
      submissionStatus: profile.submissionStatus,
      approvalStatus: profile.approvalStatus,
      isSuspended: !!profile.suspendedAt,
      rejectionReason: profile.rejectionReason,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      roles,
      kycCompliance,
    };
  }

  /**
   * Serializes a DriverDocument, strictly avoiding public exposure of internal filesystem or storage paths.
   */
  private serializeDocument(
    doc: DriverDocument,
    isLatest?: boolean
  ): DriverDocumentResponse {
    const expiryEval = DateUtil.evaluateCalendarExpiry(doc.expiryDate);

    return {
      id: doc.id.toString(),
      driverId: doc.driverId.toString(),
      documentType: doc.documentType,
      verificationStatus: doc.verificationStatus,
      rejectionReason: doc.rejectionReason,
      expiryDate: doc.expiryDate ? expiryEval.formattedExpiry : null,
      uploadedAt: doc.uploadedAt.toISOString(),
      isLatest,
      isExpired: expiryEval.isExpired,
      isExpiringSoon: expiryEval.isExpiringSoon,
      daysRemaining: expiryEval.daysRemaining,
      hasFile: !!doc.documentStorageKey,
    };
  }

  /**
   * Create or retrieve the driver's profile for the authenticated user.
   *
   * Business Rules:
   * 1. Enforces exactly one driver profile per user.
   * 2. Automatically ensures the DRIVER role is assigned to the user in user_roles.
   * 3. Strictly preserves existing CUSTOMER, PARTNER, or ADMIN roles without disruption.
   * 4. Initial status is DRAFT / PENDING.
   */
  public async getOrCreateProfile(
    userIdInput: bigint | string,
    initialData?: Partial<CreateDriverProfileData>
  ): Promise<DriverProfileResponse> {
    const userId = BigInt(userIdInput);

    // 1. Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundError(`User with ID ${userId.toString()} not found.`);
    }

    // 2. Check if driver profile already exists (Idempotent)
    let profile = await this.profileRepo.findByUserId(userId);

    if (profile) {
      const roleNames = user.userRoles.map((ur) => ur.role.roleName);
      return this.serializeProfile(profile, roleNames);
    }

    // 3. Atomically create profile and assign DRIVER role (preserving other roles)
    profile = await prisma.$transaction(async (tx) => {
      // Check if DRIVER role is assigned
      const hasDriverRole = user.userRoles.some((ur) => ur.role.roleName === 'DRIVER');
      if (!hasDriverRole) {
        const driverRole = await tx.role.findUnique({
          where: { roleName: 'DRIVER' },
        });

        if (driverRole) {
          await tx.userRole.create({
            data: {
              userId,
              roleId: driverRole.id,
            },
          });
          logger.info(`[Driver Onboarding] Assigned DRIVER role to user ${userId.toString()}`);
        }
      }

      // Create driver profile
      const newProfile = await this.profileRepo.create(
        {
          userId,
          firstName: (initialData?.firstName || 'Driver').trim(),
          lastName: initialData?.lastName ? initialData.lastName.trim() : null,
          dateOfBirth: initialData?.dateOfBirth ?? null,
          gender: initialData?.gender ?? null,
          licenceNumber: initialData?.licenceNumber ?? null,
          licenceClasses: initialData?.licenceClasses ?? [],
          licenceExpiryDate: initialData?.licenceExpiryDate ?? null,
          experienceYears: initialData?.experienceYears ?? 0,
          submissionStatus: 'DRAFT',
          approvalStatus: 'PENDING',
        },
        tx
      );

      return newProfile;
    });

    // Re-fetch roles
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    const roles = updatedUser?.userRoles.map((ur) => ur.role.roleName) || ['CUSTOMER', 'DRIVER'];

    logger.info(
      `[Driver Onboarding] Initialized driver profile ${profile.id.toString()} for user ${userId.toString()}`
    );

    return this.serializeProfile(profile, roles);
  }

  /**
   * Retrieves profile and current KYC compliance summary for the authenticated user.
   */
  public async getProfile(userIdInput: bigint | string): Promise<DriverProfileResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Driver profile not found. Please complete initial onboarding.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    const roles = user?.userRoles.map((ur) => ur.role.roleName) || [];

    // Evaluate KYC compliance
    const kycResult = await this.kycValidator.validateDriverWithRepository(profile.id);

    return this.serializeProfile(profile, roles, kycResult);
  }

  /**
   * Updates driver profile fields while not yet approved or submitted.
   *
   * Business Rules:
   * 1. Cannot update if driver profile is suspended.
   * 2. Cannot update directly if submissionStatus is 'SUBMITTED' or 'UNDER_REVIEW'.
   * 3. Cannot update directly if approvalStatus is 'APPROVED' (requires admin workflow).
   * 4. Normalizes and validates all field formats, ranges, and dates.
   */
  public async updateProfile(
    userIdInput: bigint | string,
    input: UpdateDriverProfileInput
  ): Promise<DriverProfileResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Driver profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Driver profile is suspended. Please contact platform support.');
    }

    if (profile.approvalStatus === 'APPROVED') {
      throw new ConflictError(
        'Approved driver profile cannot be modified directly through onboarding. Please request an administrative update.'
      );
    }

    if (profile.submissionStatus === 'SUBMITTED' || profile.submissionStatus === 'UNDER_REVIEW') {
      throw new ConflictError(
        'Profile cannot be modified while under review. Please wait for the compliance review to conclude.'
      );
    }

    const updateData: UpdateDriverProfileData = {};

    // 1. First & Last Name
    if (input.firstName !== undefined) {
      const trimmed = input.firstName.trim();
      if (!trimmed || trimmed.length < 2) {
        throw new BadRequestError('First name must be at least 2 characters.');
      }
      if (trimmed.length > 100) {
        throw new BadRequestError('First name cannot exceed 100 characters.');
      }
      updateData.firstName = trimmed;
    }

    if (input.lastName !== undefined) {
      updateData.lastName = input.lastName ? input.lastName.trim().slice(0, 100) : null;
    }

    // 2. Date of Birth & Minimum Age (18 years)
    if (input.dateOfBirth !== undefined) {
      if (!input.dateOfBirth) {
        updateData.dateOfBirth = null;
      } else {
        const parsedDob = DateUtil.parseCalendarDate(input.dateOfBirth);
        const dobDate = new Date(Date.UTC(parsedDob.year, parsedDob.month - 1, parsedDob.day));
        const now = new Date();
        const ageYears =
          now.getUTCFullYear() -
          parsedDob.year -
          (now.getUTCMonth() < parsedDob.month - 1 ||
          (now.getUTCMonth() === parsedDob.month - 1 && now.getUTCDate() < parsedDob.day)
            ? 1
            : 0);

        if (ageYears < 18) {
          throw new BadRequestError('Driver must be at least 18 years of age.');
        }
        if (ageYears > 80) {
          throw new BadRequestError('Invalid date of birth representation.');
        }
        updateData.dateOfBirth = dobDate;
      }
    }

    // 3. Gender
    if (input.gender !== undefined) {
      if (!input.gender) {
        updateData.gender = null;
      } else {
        const normalizedGender = input.gender.trim().toUpperCase();
        if (!['MALE', 'FEMALE', 'OTHER'].includes(normalizedGender)) {
          throw new BadRequestError("Gender must be one of 'MALE', 'FEMALE', or 'OTHER'.");
        }
        updateData.gender = normalizedGender;
      }
    }

    // 4. Bio
    if (input.bio !== undefined) {
      updateData.bio = input.bio ? input.bio.trim().slice(0, 1000) : null;
    }

    // 5. Experience Years
    if (input.experienceYears !== undefined) {
      const years = Number(input.experienceYears);
      if (isNaN(years) || years < 0 || years > 60 || !Number.isInteger(years)) {
        throw new BadRequestError('Experience years must be an integer between 0 and 60.');
      }
      updateData.experienceYears = years;
    }

    // 6. Licence Number
    if (input.licenceNumber !== undefined) {
      if (!input.licenceNumber) {
        updateData.licenceNumber = null;
      } else {
        const normalizedLicence = input.licenceNumber
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '-');
        if (normalizedLicence.length < 5 || normalizedLicence.length > 50) {
          throw new BadRequestError('Licence number must be between 5 and 50 characters.');
        }
        updateData.licenceNumber = normalizedLicence;
      }
    }

    // 7. Licence Classes
    if (input.licenceClasses !== undefined) {
      if (!Array.isArray(input.licenceClasses)) {
        throw new BadRequestError('Licence classes must be an array of endorsement codes.');
      }
      const cleanedClasses = input.licenceClasses
        .map((c) => String(c).trim().toUpperCase())
        .filter((c) => c.length > 0);

      // Deduplicate
      updateData.licenceClasses = Array.from(new Set(cleanedClasses));
    }

    // 8. Licence Expiry Date
    if (input.licenceExpiryDate !== undefined) {
      if (!input.licenceExpiryDate) {
        updateData.licenceExpiryDate = null;
      } else {
        updateData.licenceExpiryDate = DateUtil.toCalendarMidnight(input.licenceExpiryDate);
      }
    }

    // 9. Issuing Authority
    if (input.issuingAuthority !== undefined) {
      updateData.issuingAuthority = input.issuingAuthority
        ? input.issuingAuthority.trim().slice(0, 100)
        : null;
    }

    // 10. Profile Image URL
    if (input.profileImageUrl !== undefined) {
      updateData.profileImageUrl = input.profileImageUrl
        ? input.profileImageUrl.trim()
        : null;
    }

    const updatedProfile = await this.profileRepo.update(profile.id, updateData);

    logger.info(
      `[Driver Onboarding] Driver profile ${profile.id.toString()} updated by user ${userId.toString()}`
    );

    return this.serializeProfile(updatedProfile);
  }

  /**
   * Submits the driver profile for compliance and administrative review.
   *
   * Lifecycle Transition: DRAFT -> SUBMITTED.
   * Approval Status remains PENDING (Onboarding NEVER approves a profile).
   */
  public async submitProfile(
    userIdInput: bigint | string,
    policyParams: DriverKycPolicyParams = {}
  ): Promise<DriverProfileResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Driver profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Driver profile is suspended. Please contact platform support.');
    }

    // State transition guard
    if (profile.submissionStatus === 'SUBMITTED' || profile.submissionStatus === 'UNDER_REVIEW') {
      throw new ConflictError(
        'Driver profile has already been submitted and is currently pending review.'
      );
    }

    if (profile.approvalStatus === 'APPROVED') {
      throw new ConflictError('Driver profile is already approved.');
    }

    if (profile.submissionStatus === 'REJECTED' || profile.approvalStatus === 'REJECTED') {
      throw new ConflictError(
        'Rejected driver profile cannot be submitted directly. Please use resubmitProfile after correcting issues.'
      );
    }

    // Profile field completeness validation
    if (!profile.firstName || profile.firstName.trim().length < 2) {
      throw new ValidationError('First name is required before submission.');
    }

    if (!profile.licenceNumber || profile.licenceNumber.trim().length < 5) {
      throw new ValidationError('Valid driving licence number is required before submission.');
    }

    if (!profile.licenceClasses || profile.licenceClasses.length === 0) {
      throw new ValidationError('At least one driving licence class is required before submission.');
    }

    if (!profile.dateOfBirth) {
      throw new ValidationError('Date of birth is required before submission.');
    }

    // Document completeness verification via KYC Validation Service
    const kycResult = await this.kycValidator.validateDriverWithRepository(
      profile.id,
      policyParams
    );

    if (kycResult.missingTypes && kycResult.missingTypes.length > 0) {
      throw new ValidationError('Cannot submit profile: Mandatory documents missing.', {
        missingTypes: kycResult.missingTypes,
        reasons: kycResult.reasons,
      });
    }

    // Atomically transition submissionStatus to SUBMITTED
    const updatedProfile = await this.profileRepo.updateSubmissionStatus(
      profile.id,
      'SUBMITTED'
    );

    logger.info(
      `[Driver Onboarding] Driver profile ${profile.id.toString()} submitted for review by user ${userId.toString()}`
    );

    return this.serializeProfile(updatedProfile, undefined, kycResult);
  }

  /**
   * Resubmits a previously rejected driver profile after correcting deficiencies.
   *
   * Lifecycle Transition: REJECTED -> SUBMITTED.
   * Resets approvalStatus to PENDING and clears previous rejectionReason.
   */
  public async resubmitProfile(
    userIdInput: bigint | string,
    policyParams: DriverKycPolicyParams = {}
  ): Promise<DriverProfileResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Driver profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Driver profile is suspended. Please contact platform support.');
    }

    if (profile.approvalStatus === 'APPROVED') {
      throw new ConflictError('Driver profile is already approved.');
    }

    if (profile.submissionStatus === 'DRAFT') {
      throw new ConflictError(
        'Draft profile has not been rejected. Please use submitProfile instead.'
      );
    }

    if (profile.submissionStatus === 'SUBMITTED' || profile.submissionStatus === 'UNDER_REVIEW') {
      throw new ConflictError(
        'Driver profile is already submitted and pending review.'
      );
    }

    if (profile.approvalStatus !== 'REJECTED' && profile.submissionStatus !== 'REJECTED') {
      throw new ConflictError('Only rejected driver profiles can be resubmitted.');
    }

    // Profile & document completeness verification
    if (!profile.licenceNumber || !profile.licenceClasses || profile.licenceClasses.length === 0) {
      throw new ValidationError('Driving licence information is required before resubmission.');
    }

    const kycResult = await this.kycValidator.validateDriverWithRepository(
      profile.id,
      policyParams
    );

    if (kycResult.missingTypes && kycResult.missingTypes.length > 0) {
      throw new ValidationError('Cannot resubmit profile: Mandatory documents missing.', {
        missingTypes: kycResult.missingTypes,
        reasons: kycResult.reasons,
      });
    }

    // Atomically reset status to SUBMITTED / PENDING and clear rejection reason
    const updatedProfile = await prisma.driverProfile.update({
      where: { id: profile.id },
      data: {
        submissionStatus: 'SUBMITTED',
        approvalStatus: 'PENDING',
        rejectionReason: null,
      },
    });

    logger.info(
      `[Driver Onboarding] Driver profile ${profile.id.toString()} resubmitted for review by user ${userId.toString()}`
    );

    return this.serializeProfile(updatedProfile, undefined, kycResult);
  }

  /**
   * Securely uploads a driver document using private storage infrastructure.
   *
   * Business Rules:
   * 1. Validates document type against approved driver document types.
   * 2. Enforces file size limit (5MB) and approved MIME types.
   * 3. Validates file content using magic-byte analysis, rejecting MIME spoofing.
   * 4. Generates a collision-resistant private storage key (never trusts client filenames).
   * 5. Document replacement is additive: creating a new record preserves previous history.
   * 6. Anti-orphan safety: If database insertion fails, the uploaded storage file is immediately cleaned up.
   * 7. Sanitizes response: Never exposes internal filesystem paths or raw storage keys.
   */
  public async uploadDocument(
    userIdInput: bigint | string,
    input: UploadDriverDocumentInput,
    file: UploadedFile
  ): Promise<DriverDocumentResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Driver profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Driver profile is suspended. Please contact platform support.');
    }

    if (!input || !input.documentType) {
      throw new BadRequestError('Document type is required.');
    }

    const normalizedDocType = input.documentType.trim().toUpperCase();
    if (!ALLOWED_DRIVER_DOCUMENT_TYPES.includes(normalizedDocType as any)) {
      throw new BadRequestError(
        `Invalid or unsupported driver document type '${input.documentType}'. Allowed types: ${ALLOWED_DRIVER_DOCUMENT_TYPES.join(
          ', '
        )}`
      );
    }

    if (!file || !file.buffer) {
      throw new BadRequestError('Physical file buffer must be provided.');
    }

    if (file.size > MAX_DRIVER_DOCUMENT_SIZE_BYTES) {
      throw new BadRequestError(
        `File size exceeds maximum permitted limit of ${MAX_DRIVER_DOCUMENT_SIZE_BYTES / (1024 * 1024)}MB.`
      );
    }

    // Magic-byte content verification (detects MIME spoofing)
    const detectedMime = validateFileMagicBytes(file.buffer, file.mimetype);

    let parsedExpiry: Date | null = null;
    if (input.expiryDate) {
      parsedExpiry = DateUtil.toCalendarMidnight(input.expiryDate);
    }

    // Step 1: Upload to private storage
    const uploadResult = await this.storage.uploadFile(
      file.buffer,
      file.originalname,
      detectedMime,
      'drivers'
    );
    const storageKey = uploadResult.storageKey;

    // Step 2: Database record insertion with anti-orphan safety
    let doc: DriverDocument;
    try {
      doc = await this.documentRepo.create({
        driverId: profile.id,
        documentType: normalizedDocType,
        documentStorageKey: storageKey,
        expiryDate: parsedExpiry,
        verificationStatus: 'PENDING',
        documentMetadata: input.documentMetadata
          ? (input.documentMetadata as Prisma.InputJsonValue)
          : null,
      });

      logger.info(
        `[Driver Document Upload] Driver ${profile.id.toString()} uploaded ${normalizedDocType} (Doc ID: ${doc.id.toString()})`
      );
    } catch (dbErr) {
      logger.error(
        `[Driver Document Upload] Database insertion failed. Cleaning up orphaned storage key: ${storageKey}`,
        dbErr
      );
      // Clean up uploaded file immediately to prevent orphaned storage leaks
      await this.storage.deleteFile(storageKey);
      throw dbErr;
    }

    return this.serializeDocument(doc, true);
  }

  /**
   * Lists all documents uploaded by the authenticated driver.
   * Labels the latest document per document type.
   */
  public async getDocuments(
    userIdInput: bigint | string
  ): Promise<DriverDocumentResponse[]> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Driver profile not found.');
    }

    const documents = await this.documentRepo.findByDriverId(profile.id);

    // Identify the latest document per document type
    const latestDocMap = new Map<string, bigint>();
    for (const d of documents) {
      const type = d.documentType.toUpperCase();
      const currentLatestId = latestDocMap.get(type);
      if (!currentLatestId || d.id > currentLatestId) {
        latestDocMap.set(type, d.id);
      }
    }

    return documents.map((d) => {
      const isLatest = latestDocMap.get(d.documentType.toUpperCase()) === d.id;
      return this.serializeDocument(d, isLatest);
    });
  }

  /**
   * Securely streams a document for the authenticated driver.
   * Enforces cross-driver tenant isolation: drivers can access only their own documents.
   */
  public async streamDocument(
    userIdInput: bigint | string,
    documentIdInput: bigint | string
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const userId = BigInt(userIdInput);
    const documentId = BigInt(documentIdInput);

    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new NotFoundError('Driver profile not found.');
    }

    const doc = await this.documentRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document with ID ${documentId.toString()} not found.`);
    }

    // Strict Ownership Enforcement: Prevent IDOR attacks
    if (doc.driverId !== profile.id) {
      logger.warn(
        `[Driver Document Security] Unauthorized access attempt: User ${userId.toString()} attempted to access Document ${documentId.toString()} owned by Driver ${doc.driverId.toString()}`
      );
      throw new ForbiddenError('You do not have permission to access this document.');
    }

    return await this.storage.getFile(doc.documentStorageKey);
  }
}

// Default singleton export
export const driverOnboardingService = new DriverOnboardingService();
