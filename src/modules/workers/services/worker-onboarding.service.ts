import { Prisma, WorkerProfile, WorkerDocument, WorkerSkill } from '@prisma/client';
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
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { WorkerDocumentRepository } from '../repositories/worker-document.repository';
import { WorkerSkillRepository } from '../repositories/worker-skill.repository';
import {
  WorkerKycValidationService,
  workerKycValidationService,
  WorkerKycValidationResult,
  WorkerKycPolicyParams,
} from './worker-kyc.service';
import {
  CreateWorkerProfileData,
  UpdateWorkerProfileData,
} from '../workers.types';

// ============================================================================
// Constants & Allowed Types
// ============================================================================

export const ALLOWED_WORKER_DOCUMENT_TYPES = [
  'IDENTITY_PROOF',
  'PROFILE_PHOTO',
  'POLICE_VERIFICATION',
  'ADDRESS_PROOF',
  'SKILL_CERTIFICATE',
  'MEDICAL_FITNESS',
  'OTHER',
] as const;

export type WorkerDocumentType = (typeof ALLOWED_WORKER_DOCUMENT_TYPES)[number];

export const MAX_WORKER_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const APPROVED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const VALID_WORKER_TYPES = ['HELPER', 'TECHNICIAN', 'SPECIALIST'] as const;

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

export interface UploadWorkerDocumentInput {
  documentType: string;
  expiryDate?: Date | string | null;
  documentMetadata?: Record<string, any>;
}

export interface UpdateWorkerProfileInput {
  firstName?: string;
  lastName?: string | null;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  bio?: string | null;
  profileImageUrl?: string | null;
  workerType?: string;
  experienceYears?: number;
  primaryCityId?: bigint | string | null;
}

export interface AddWorkerSkillInput {
  serviceCategoryId: bigint | string;
  experienceYears?: number;
}

export interface WorkerProfileResponse {
  id: string;
  userId: string;
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  profileImageUrl: string | null;
  bio: string | null;
  workerType: string;
  experienceYears: number;
  primaryCityId: string | null;
  primaryCityName?: string | null;
  submissionStatus: string;
  approvalStatus: string;
  isSuspended: boolean;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  roles?: string[];
  kycCompliance?: WorkerKycValidationResult;
}

export interface WorkerDocumentResponse {
  id: string;
  workerId: string;
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

export interface WorkerSkillResponse {
  id: string;
  workerId: string;
  serviceCategoryId: string;
  serviceCategoryName: string;
  serviceCategoryCode: string;
  experienceYears: number;
  verificationStatus: string;
  rejectionReason: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerOnboardingStatusResponse {
  workerId: string;
  submissionStatus: string;
  approvalStatus: string;
  workerType: string;
  isSuspended: boolean;
  rejectionReason: string | null;
  isReadyForSubmission: boolean;
  kycCompliance: WorkerKycValidationResult;
  documentsSummary: {
    total: number;
    verified: number;
    pending: number;
    rejected: number;
  };
  skillsSummary: {
    total: number;
    verified: number;
    pending: number;
    rejected: number;
  };
}

// ============================================================================
// Worker Onboarding Service Implementation
// ============================================================================

export class WorkerOnboardingService {
  constructor(
    private profileRepo: WorkerProfileRepository = new WorkerProfileRepository(),
    private documentRepo: WorkerDocumentRepository = new WorkerDocumentRepository(),
    private skillRepo: WorkerSkillRepository = new WorkerSkillRepository(),
    private storage: IStorageService = storageService,
    private kycValidator: WorkerKycValidationService = workerKycValidationService
  ) {}

  /**
   * Serializes a WorkerProfile into an API-safe response, stripping sensitive internals.
   */
  private serializeProfile(
    profile: WorkerProfile & { primaryCity?: { id: bigint; cityName: string; stateName: string } | null },
    roles?: string[],
    kycCompliance?: WorkerKycValidationResult
  ): WorkerProfileResponse {
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
      workerType: profile.workerType,
      experienceYears: profile.experienceYears,
      primaryCityId: profile.primaryCityId ? profile.primaryCityId.toString() : null,
      primaryCityName: profile.primaryCity?.cityName || null,
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
   * Serializes a WorkerDocument, strictly avoiding public exposure of internal filesystem or storage paths.
   */
  private serializeDocument(
    doc: WorkerDocument,
    isLatest?: boolean
  ): WorkerDocumentResponse {
    const expiryEval = DateUtil.evaluateCalendarExpiry(doc.expiryDate);

    return {
      id: doc.id.toString(),
      workerId: doc.workerId.toString(),
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
   * Serializes a WorkerSkill with service category information.
   */
  private serializeSkill(
    skill: WorkerSkill & { serviceCategory?: { id: bigint; categoryName: string; categoryCode: string } | null }
  ): WorkerSkillResponse {
    return {
      id: skill.id.toString(),
      workerId: skill.workerId.toString(),
      serviceCategoryId: skill.serviceCategoryId.toString(),
      serviceCategoryName: skill.serviceCategory?.categoryName || 'Unknown',
      serviceCategoryCode: skill.serviceCategory?.categoryCode || 'UNKNOWN',
      experienceYears: skill.experienceYears,
      verificationStatus: skill.verificationStatus,
      rejectionReason: skill.rejectionReason,
      isActive: skill.isActive,
      createdAt: skill.createdAt.toISOString(),
      updatedAt: skill.updatedAt.toISOString(),
    };
  }

  /**
   * Create or retrieve the worker profile for the authenticated user.
   *
   * Business Rules:
   * 1. Independent registration works without partner affiliation.
   * 2. Exactly one worker profile per user (Idempotent).
   * 3. Assigns WORKER role in user_roles, strictly preserving existing CUSTOMER, PARTNER, ADMIN roles.
   * 4. Initial status is DRAFT / PENDING (creating profile does not approve it).
   * 5. Assigning WORKER role does not imply operational approval.
   */
  public async getOrCreateProfile(
    userIdInput: bigint | string,
    initialData?: Partial<CreateWorkerProfileData>
  ): Promise<WorkerProfileResponse> {
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

    // 2. Check if worker profile already exists (Idempotent)
    let profile = await this.profileRepo.findByUserId(userId);

    if (profile) {
      const roleNames = user.userRoles.map((ur) => ur.role.roleName);
      return this.serializeProfile(profile as any, roleNames);
    }

    // 3. Atomically create profile and assign WORKER role (preserving other roles)
    profile = await prisma.$transaction(async (tx) => {
      // Check if WORKER role is assigned
      const hasWorkerRole = user.userRoles.some((ur) => ur.role.roleName === 'WORKER');
      if (!hasWorkerRole) {
        let workerRole = await tx.role.findUnique({
          where: { roleName: 'WORKER' },
        });

        if (!workerRole) {
          // If WORKER role record missing, create it
          workerRole = await tx.role.create({
            data: {
              roleName: 'WORKER',
              description: 'Service Worker / Tradesperson Role',
            },
          });
        }

        await tx.userRole.create({
          data: {
            userId,
            roleId: workerRole.id,
          },
        });
        logger.info(`[Worker Onboarding] Assigned WORKER role to user ${userId.toString()}`);
      }

      // Create worker profile
      const newProfile = await this.profileRepo.create(
        {
          userId,
          firstName: (initialData?.firstName || 'Worker').trim(),
          lastName: initialData?.lastName ? initialData.lastName.trim() : null,
          dateOfBirth: initialData?.dateOfBirth ?? null,
          gender: initialData?.gender ?? null,
          bio: initialData?.bio ?? null,
          profileImageUrl: initialData?.profileImageUrl ?? null,
          workerType: initialData?.workerType || 'HELPER',
          experienceYears: initialData?.experienceYears ?? 0,
          primaryCityId: initialData?.primaryCityId ?? null,
          submissionStatus: 'DRAFT',
          approvalStatus: 'PENDING',
        },
        tx
      );

      return newProfile;
    });

    // Re-fetch user roles
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    const roles = updatedUser?.userRoles.map((ur) => ur.role.roleName) || ['CUSTOMER', 'WORKER'];

    logger.info(
      `[Worker Onboarding] Initialized worker profile ${profile.id.toString()} for user ${userId.toString()}`
    );

    return this.serializeProfile(profile as any, roles);
  }

  /**
   * Retrieves profile and current KYC compliance summary for the authenticated user.
   */
  public async getMyProfile(userIdInput: bigint | string): Promise<WorkerProfileResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found. Please complete initial onboarding.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    const roles = user?.userRoles.map((ur) => ur.role.roleName) || [];

    // Evaluate KYC compliance
    const kycResult = await this.kycValidator.validateWorkerWithRepository(profile.id);

    return this.serializeProfile(profile as any, roles, kycResult);
  }

  /**
   * Updates worker profile fields while in draft or revision.
   *
   * Business Rules:
   * 1. Cannot update if worker profile is suspended.
   * 2. Cannot update directly if submissionStatus is 'SUBMITTED' or 'UNDER_REVIEW'.
   * 3. Cannot update directly if approvalStatus is 'APPROVED' (requires admin workflow).
   * 4. Normalizes and validates all field formats, age, worker types.
   */
  public async updateMyProfile(
    userIdInput: bigint | string,
    input: UpdateWorkerProfileInput
  ): Promise<WorkerProfileResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended. Please contact platform support.');
    }

    if (profile.approvalStatus === 'APPROVED') {
      throw new ConflictError(
        'Approved worker profile cannot be modified directly through onboarding. Please request an administrative update.'
      );
    }

    if (profile.submissionStatus === 'SUBMITTED' || profile.submissionStatus === 'UNDER_REVIEW') {
      throw new ConflictError(
        'Profile cannot be modified while under review. Please wait for the compliance review to conclude.'
      );
    }

    const updateData: UpdateWorkerProfileData = {};

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
          throw new BadRequestError('Worker must be at least 18 years of age.');
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

    // 5. Worker Type
    if (input.workerType !== undefined) {
      const normalizedType = input.workerType.trim().toUpperCase();
      if (!VALID_WORKER_TYPES.includes(normalizedType as any)) {
        throw new BadRequestError(
          `Invalid worker type '${input.workerType}'. Allowed types: ${VALID_WORKER_TYPES.join(', ')}.`
        );
      }
      updateData.workerType = normalizedType;
    }

    // 6. Experience Years
    if (input.experienceYears !== undefined) {
      const years = Number(input.experienceYears);
      if (isNaN(years) || years < 0 || years > 60 || !Number.isInteger(years)) {
        throw new BadRequestError('Experience years must be an integer between 0 and 60.');
      }
      updateData.experienceYears = years;
    }

    // 7. Primary City ID
    if (input.primaryCityId !== undefined) {
      if (!input.primaryCityId) {
        updateData.primaryCityId = null;
      } else {
        const cityId = BigInt(input.primaryCityId);
        const city = await prisma.city.findUnique({ where: { id: cityId } });
        if (!city || !city.isActive) {
          throw new BadRequestError('Specified primary city does not exist or is inactive.');
        }
        updateData.primaryCityId = cityId;
      }
    }

    // 8. Profile Image URL
    if (input.profileImageUrl !== undefined) {
      updateData.profileImageUrl = input.profileImageUrl ? input.profileImageUrl.trim() : null;
    }

    const updatedProfile = await this.profileRepo.update(profile.id, updateData);

    logger.info(
      `[Worker Onboarding] Worker profile ${profile.id.toString()} updated by user ${userId.toString()}`
    );

    return this.serializeProfile(updatedProfile as any);
  }

  /**
   * Submits the worker profile for compliance and administrative review.
   *
   * Business Rules:
   * 1. Lifecycle Transition: DRAFT -> SUBMITTED.
   * 2. Approval Status remains PENDING (Onboarding NEVER approves a profile).
   * 3. Locks profile against conflicting concurrent changes.
   * 4. Enforces profile completeness and mandatory KYC documents/skills.
   */
  public async submitOnboarding(
    userIdInput: bigint | string,
    policyParams: WorkerKycPolicyParams = {}
  ): Promise<WorkerProfileResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended. Please contact platform support.');
    }

    // State transition guard
    if (profile.submissionStatus === 'SUBMITTED' || profile.submissionStatus === 'UNDER_REVIEW') {
      throw new ConflictError(
        'Worker profile has already been submitted and is currently pending review.'
      );
    }

    if (profile.approvalStatus === 'APPROVED') {
      throw new ConflictError('Worker profile is already approved.');
    }

    if (profile.submissionStatus === 'REJECTED' || profile.approvalStatus === 'REJECTED') {
      throw new ConflictError(
        'Rejected worker profile cannot be submitted directly. Please use resubmitOnboarding after addressing feedback.'
      );
    }

    // Profile field completeness validation
    if (!profile.firstName || profile.firstName.trim().length < 2) {
      throw new ValidationError('First name is required before submission.');
    }

    if (!profile.dateOfBirth) {
      throw new ValidationError('Date of birth is required before submission.');
    }

    // KYC compliance verification
    const kycResult = await this.kycValidator.validateWorkerWithRepository(
      profile.id,
      policyParams
    );

    if (kycResult.missingDocuments && kycResult.missingDocuments.length > 0) {
      throw new ValidationError('Cannot submit profile: Mandatory documents missing.', {
        missingDocuments: kycResult.missingDocuments,
        reasons: kycResult.reasons,
      });
    }

    if (kycResult.missingSkills && kycResult.missingSkills.length > 0) {
      throw new ValidationError('Cannot submit profile: Required skills missing.', {
        missingSkills: kycResult.missingSkills,
        reasons: kycResult.reasons,
      });
    }

    // Atomically transition submissionStatus to SUBMITTED
    const updatedProfile = await this.profileRepo.updateSubmissionStatus(
      profile.id,
      'SUBMITTED',
      new Date()
    );

    logger.info(
      `[Worker Onboarding] Worker profile ${profile.id.toString()} submitted for review by user ${userId.toString()}`
    );

    return this.serializeProfile(updatedProfile as any, undefined, kycResult);
  }

  /**
   * Resubmits a previously rejected worker profile after correcting deficiencies.
   *
   * Lifecycle Transition: REJECTED / ACTION_REQUIRED -> SUBMITTED.
   * Resets approvalStatus to PENDING and clears previous rejectionReason.
   */
  public async resubmitOnboarding(
    userIdInput: bigint | string,
    policyParams: WorkerKycPolicyParams = {}
  ): Promise<WorkerProfileResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended. Please contact platform support.');
    }

    if (profile.approvalStatus === 'APPROVED') {
      throw new ConflictError('Worker profile is already approved.');
    }

    if (profile.submissionStatus === 'DRAFT') {
      throw new ConflictError(
        'Draft profile has not been reviewed yet. Please use submitOnboarding instead.'
      );
    }

    if (profile.submissionStatus === 'SUBMITTED' || profile.submissionStatus === 'UNDER_REVIEW') {
      throw new ConflictError('Worker profile is already submitted and pending review.');
    }

    if (
      profile.approvalStatus !== 'REJECTED' &&
      profile.submissionStatus !== 'REJECTED' &&
      profile.submissionStatus !== 'ACTION_REQUIRED'
    ) {
      throw new ConflictError('Only rejected or action-required worker profiles can be resubmitted.');
    }

    // Profile & document completeness verification
    if (!profile.firstName || profile.firstName.trim().length < 2) {
      throw new ValidationError('First name is required before resubmission.');
    }

    const kycResult = await this.kycValidator.validateWorkerWithRepository(
      profile.id,
      policyParams
    );

    if (kycResult.missingDocuments && kycResult.missingDocuments.length > 0) {
      throw new ValidationError('Cannot resubmit profile: Mandatory documents missing.', {
        missingDocuments: kycResult.missingDocuments,
        reasons: kycResult.reasons,
      });
    }

    if (kycResult.missingSkills && kycResult.missingSkills.length > 0) {
      throw new ValidationError('Cannot resubmit profile: Required skills missing.', {
        missingSkills: kycResult.missingSkills,
        reasons: kycResult.reasons,
      });
    }

    // Atomically reset status to SUBMITTED / PENDING and clear rejection reason
    const updatedProfile = await prisma.workerProfile.update({
      where: { id: profile.id },
      data: {
        submissionStatus: 'SUBMITTED',
        approvalStatus: 'PENDING',
        rejectionReason: null,
        submittedAt: new Date(),
      },
      include: {
        primaryCity: {
          select: {
            id: true,
            cityName: true,
            stateName: true,
          },
        },
      },
    });

    logger.info(
      `[Worker Onboarding] Worker profile ${profile.id.toString()} resubmitted for review by user ${userId.toString()}`
    );

    return this.serializeProfile(updatedProfile as any, undefined, kycResult);
  }

  /**
   * Retrieves high-level onboarding compliance overview.
   */
  public async getOnboardingStatus(
    userIdInput: bigint | string,
    policyParams: WorkerKycPolicyParams = {}
  ): Promise<WorkerOnboardingStatusResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found. Please complete initial onboarding.');
    }

    const [documents, skills, kycCompliance] = await Promise.all([
      this.documentRepo.findByWorkerId(profile.id),
      this.skillRepo.findByWorkerId(profile.id),
      this.kycValidator.validateWorkerWithRepository(profile.id, policyParams),
    ]);

    const documentsSummary = {
      total: documents.length,
      verified: documents.filter((d) => d.verificationStatus === 'VERIFIED').length,
      pending: documents.filter((d) => d.verificationStatus === 'PENDING').length,
      rejected: documents.filter((d) => d.verificationStatus === 'REJECTED').length,
    };

    const skillsSummary = {
      total: skills.length,
      verified: skills.filter((s) => s.verificationStatus === 'VERIFIED').length,
      pending: skills.filter((s) => s.verificationStatus === 'PENDING').length,
      rejected: skills.filter((s) => s.verificationStatus === 'REJECTED').length,
    };

    const isReadyForSubmission =
      profile.submissionStatus === 'DRAFT' ||
      profile.submissionStatus === 'REJECTED' ||
      profile.submissionStatus === 'ACTION_REQUIRED';

    return {
      workerId: profile.id.toString(),
      submissionStatus: profile.submissionStatus,
      approvalStatus: profile.approvalStatus,
      workerType: profile.workerType,
      isSuspended: !!profile.suspendedAt,
      rejectionReason: profile.rejectionReason,
      isReadyForSubmission,
      kycCompliance,
      documentsSummary,
      skillsSummary,
    };
  }

  /**
   * Securely uploads a worker document using private storage infrastructure.
   *
   * Business Rules:
   * 1. Validates document type against approved worker document types.
   * 2. Enforces file size limit (5MB) and approved MIME types.
   * 3. Validates file content using magic-byte analysis, rejecting MIME spoofing.
   * 4. Generates a collision-resistant UUID storage key (never trusts client filenames).
   * 5. Document replacement is additive: creating a new record preserves previous history.
   * 6. Anti-orphan safety: If database insertion fails, uploaded storage file is immediately cleaned up.
   * 7. Sanitizes response: Never exposes internal filesystem paths or raw storage keys.
   */
  public async uploadDocument(
    userIdInput: bigint | string,
    input: UploadWorkerDocumentInput,
    file: UploadedFile
  ): Promise<WorkerDocumentResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended. Please contact platform support.');
    }

    if (!input || !input.documentType) {
      throw new BadRequestError('Document type is required.');
    }

    const normalizedDocType = input.documentType.trim().toUpperCase();
    if (!ALLOWED_WORKER_DOCUMENT_TYPES.includes(normalizedDocType as any)) {
      throw new BadRequestError(
        `Invalid or unsupported worker document type '${input.documentType}'. Allowed types: ${ALLOWED_WORKER_DOCUMENT_TYPES.join(
          ', '
        )}`
      );
    }

    if (!file || !file.buffer) {
      throw new BadRequestError('Physical file buffer must be provided.');
    }

    if (file.size > MAX_WORKER_DOCUMENT_SIZE_BYTES) {
      throw new BadRequestError(
        `File size exceeds maximum permitted limit of ${MAX_WORKER_DOCUMENT_SIZE_BYTES / (1024 * 1024)}MB.`
      );
    }

    // Magic-byte content verification (detects MIME spoofing)
    const detectedMime = validateFileMagicBytes(file.buffer, file.mimetype);

    let parsedExpiry: Date | null = null;
    if (input.expiryDate) {
      parsedExpiry = DateUtil.toCalendarMidnight(input.expiryDate);
    }

    // Step 1: Upload to private storage under 'workers'
    const uploadResult = await this.storage.uploadFile(
      file.buffer,
      file.originalname,
      detectedMime,
      'workers'
    );
    const storageKey = uploadResult.storageKey;

    // Step 2: Database record insertion with anti-orphan safety
    let doc: WorkerDocument;
    try {
      doc = await this.documentRepo.create({
        workerId: profile.id,
        documentType: normalizedDocType,
        documentStorageKey: storageKey,
        originalName: file.originalname ? file.originalname.slice(0, 255) : null,
        mimeType: detectedMime,
        fileSizeBytes: BigInt(file.size),
        expiryDate: parsedExpiry,
        verificationStatus: 'PENDING',
        documentMetadata: input.documentMetadata
          ? (input.documentMetadata as Prisma.InputJsonValue)
          : null,
      });

      logger.info(
        `[Worker Document Upload] Worker ${profile.id.toString()} uploaded ${normalizedDocType} (Doc ID: ${doc.id.toString()})`
      );
    } catch (dbErr) {
      logger.error(
        `[Worker Document Upload] Database insertion failed. Cleaning up orphaned storage key: ${storageKey}`,
        dbErr
      );
      // Clean up uploaded file immediately to prevent orphaned storage leaks
      await this.storage.deleteFile(storageKey);
      throw dbErr;
    }

    return this.serializeDocument(doc, true);
  }

  /**
   * Replaces an existing document type by uploading a new version.
   * Additive: Strictly preserves previous records.
   */
  public async replaceDocument(
    userIdInput: bigint | string,
    input: UploadWorkerDocumentInput,
    file: UploadedFile
  ): Promise<WorkerDocumentResponse> {
    return this.uploadDocument(userIdInput, input, file);
  }

  /**
   * Lists all documents uploaded by the authenticated worker.
   * Labels the latest document per document type using deterministic ordering (uploadedAt DESC, id DESC).
   */
  public async listMyDocuments(
    userIdInput: bigint | string
  ): Promise<WorkerDocumentResponse[]> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const documents = await this.documentRepo.findByWorkerId(profile.id);

    // Identify the latest document per document type deterministically
    const latestDocMap = new Map<string, bigint>();
    for (const d of documents) {
      const type = d.documentType.toUpperCase();
      if (!latestDocMap.has(type)) {
        // findByWorkerId is sorted by uploadedAt DESC, id DESC, so first occurrence is latest
        latestDocMap.set(type, d.id);
      }
    }

    return documents.map((d) => {
      const isLatest = latestDocMap.get(d.documentType.toUpperCase()) === d.id;
      return this.serializeDocument(d, isLatest);
    });
  }

  /**
   * Retrieves single document status with ownership check.
   */
  public async getDocumentStatus(
    userIdInput: bigint | string,
    documentIdInput: bigint | string
  ): Promise<WorkerDocumentResponse> {
    const userId = BigInt(userIdInput);
    const documentId = BigInt(documentIdInput);

    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const doc = await this.documentRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Worker document with ID ${documentId.toString()} not found.`);
    }

    // Ownership check: IDOR protection
    if (doc.workerId !== profile.id) {
      throw new ForbiddenError('You do not have permission to access this document.');
    }

    return this.serializeDocument(doc);
  }

  /**
   * Securely streams a document for the authenticated worker.
   * Enforces cross-worker tenant isolation: workers can access only their own documents.
   */
  public async streamMyDocument(
    userIdInput: bigint | string,
    documentIdInput: bigint | string
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const userId = BigInt(userIdInput);
    const documentId = BigInt(documentIdInput);

    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const doc = await this.documentRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Worker document with ID ${documentId.toString()} not found.`);
    }

    // Strict Ownership Enforcement: Prevent IDOR attacks
    if (doc.workerId !== profile.id) {
      logger.warn(
        `[Worker Document Security] Unauthorized access attempt: User ${userId.toString()} attempted to access Document ${documentId.toString()} owned by Worker ${doc.workerId.toString()}`
      );
      throw new ForbiddenError('You do not have permission to access this document.');
    }

    return await this.storage.getFile(doc.documentStorageKey);
  }

  /**
   * Registers a skill / service category for the authenticated worker.
   *
   * Business Rules:
   * 1. Validates that the target service category exists and is active.
   * 2. Prevents duplicate category mappings for the worker (ConflictError).
   * 3. Initial verification status is PENDING.
   * 4. Lifecycle lock: cannot add skill while SUBMITTED or UNDER_REVIEW or APPROVED.
   */
  public async addSkill(
    userIdInput: bigint | string,
    input: AddWorkerSkillInput
  ): Promise<WorkerSkillResponse> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found. Please complete initial onboarding.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended. Please contact platform support.');
    }

    if (profile.submissionStatus === 'SUBMITTED' || profile.submissionStatus === 'UNDER_REVIEW') {
      throw new ConflictError(
        'Skills cannot be added while your profile is under compliance review.'
      );
    }

    if (profile.approvalStatus === 'APPROVED') {
      throw new ConflictError(
        'Approved worker profiles cannot add skills directly. Please request administrative skill verification.'
      );
    }

    if (!input || !input.serviceCategoryId) {
      throw new BadRequestError('Service category ID is required.');
    }

    const categoryId = BigInt(input.serviceCategoryId);

    // Validate category exists and is active
    const category = await prisma.serviceCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category || !category.isActive) {
      throw new BadRequestError('Specified service category does not exist or is inactive.');
    }

    // Prevent duplicate skill mapping
    const existing = await this.skillRepo.findByCategory(profile.id, categoryId);
    if (existing) {
      throw new ConflictError('This skill category is already registered for this worker.');
    }

    // Validate experience years
    let experienceYears = 0;
    if (input.experienceYears !== undefined) {
      const exp = Number(input.experienceYears);
      if (isNaN(exp) || exp < 0 || exp > 60 || !Number.isInteger(exp)) {
        throw new BadRequestError('Experience years must be an integer between 0 and 60.');
      }
      experienceYears = exp;
    }

    const created = await this.skillRepo.create({
      workerId: profile.id,
      serviceCategoryId: categoryId,
      experienceYears,
      verificationStatus: 'PENDING',
      isActive: true,
    });

    logger.info(
      `[Worker Skill] Worker ${profile.id.toString()} registered skill for category ${category.categoryCode} (Skill ID: ${created.id.toString()})`
    );

    return this.serializeSkill({
      ...created,
      serviceCategory: category,
    });
  }

  /**
   * Lists all skills registered by the authenticated worker.
   */
  public async listMySkills(userIdInput: bigint | string): Promise<WorkerSkillResponse[]> {
    const userId = BigInt(userIdInput);
    const profile = await this.profileRepo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const skills = await this.skillRepo.findByWorkerId(profile.id);

    return skills.map((s: any) => this.serializeSkill(s));
  }

  /**
   * Removes a skill mapping where lifecycle rules permit.
   *
   * Business Rules:
   * 1. Cannot remove skill while SUBMITTED or UNDER_REVIEW.
   * 2. Cannot remove verified skill if profile is already APPROVED.
   * 3. IDOR protection: only the owner worker can remove their own skill.
   */
  public async removeSkill(
    userIdInput: bigint | string,
    skillIdInput: bigint | string
  ): Promise<{ success: boolean; message: string }> {
    const userId = BigInt(userIdInput);
    const skillId = BigInt(skillIdInput);

    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended. Please contact platform support.');
    }

    if (profile.submissionStatus === 'SUBMITTED' || profile.submissionStatus === 'UNDER_REVIEW') {
      throw new ConflictError(
        'Skills cannot be removed while your profile is under compliance review.'
      );
    }

    const skill = await this.skillRepo.findById(skillId);
    if (!skill) {
      throw new NotFoundError(`Worker skill with ID ${skillId.toString()} not found.`);
    }

    // Ownership check
    if (skill.workerId !== profile.id) {
      throw new ForbiddenError('You do not have permission to remove this skill.');
    }

    if (profile.approvalStatus === 'APPROVED' && skill.verificationStatus === 'VERIFIED') {
      throw new ConflictError(
        'Verified skills on an approved profile cannot be removed directly. Please request administrative modification.'
      );
    }

    await this.skillRepo.delete(skillId);

    logger.info(
      `[Worker Skill] Skill ${skillId.toString()} removed for worker ${profile.id.toString()}`
    );

    return {
      success: true,
      message: 'Skill removed successfully.',
    };
  }
}

// Default singleton export
export const workerOnboardingService = new WorkerOnboardingService();
