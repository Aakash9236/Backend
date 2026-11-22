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
import {
  WorkerAdminGovernanceRepository,
  workerAdminGovernanceRepository,
} from '../repositories/worker-admin-governance.repository';
import {
  WorkerProfileRepository,
} from '../repositories/worker-profile.repository';
import {
  WorkerDocumentRepository,
} from '../repositories/worker-document.repository';
import {
  WorkerSkillRepository,
} from '../repositories/worker-skill.repository';
import {
  WorkerAvailabilityRepository,
} from '../repositories/worker-availability.repository';
import {
  WorkerKycValidationService,
  workerKycValidationService,
  WorkerKycValidationResult,
  WorkerKycPolicyParams,
} from './worker-kyc.service';
import { PaginationOptions, PaginatedResult } from '../workers.types';

// ============================================================================
// Types & DTOs
// ============================================================================

export interface AdminClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface WorkerApplicationFilter {
  approvalStatus?: string;
  submissionStatus?: string;
  workerType?: string;
  primaryCityId?: bigint | string;
  isActive?: boolean;
  search?: string;
}

export interface WorkerApplicationSummaryResponse {
  id: string;
  userId: string;
  mobileNumber: string;
  email: string | null;
  accountStatus: string;
  firstName: string;
  lastName: string | null;
  workerType: string;
  experienceYears: number;
  primaryCityId: string | null;
  primaryCityName: string | null;
  submissionStatus: string;
  approvalStatus: string;
  documentCount: number;
  unverifiedDocumentCount: number;
  skillCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerDocumentSummaryResponse {
  id: string;
  documentType: string;
  originalName: string | null;
  mimeType: string | null;
  fileSizeBytes: string | null;
  verificationStatus: string;
  rejectionReason: string | null;
  expiryDate: string | null;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  uploadedAt: string;
}

export interface WorkerSkillSummaryResponse {
  id: string;
  serviceCategoryId: string;
  categoryCode: string;
  categoryName: string;
  experienceYears: number;
  verificationStatus: string;
  rejectionReason: string | null;
  isActive: boolean;
}

export interface WorkerAffiliationSummaryResponse {
  id: string;
  partnerId: string;
  partnerBusinessName: string;
  profileType: string;
  affiliationStatus: string;
  affiliatedAt: string;
  terminatedAt: string | null;
}

export interface WorkerGovernanceDossierResponse {
  id: string;
  userId: string;
  mobileNumber: string;
  email: string | null;
  accountStatus: string;
  isMobileVerified: boolean;
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  profileImageUrl: string | null;
  bio: string | null;
  workerType: string;
  experienceYears: number;
  primaryCityId: string | null;
  primaryCityName: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  submissionStatus: string;
  submittedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  kycEvaluation: {
    isValid: boolean;
    missingDocuments: string[];
    unverifiedDocuments: string[];
    expiredDocuments: string[];
    expiringSoonDocuments: string[];
    missingSkills: string[];
    unverifiedSkills: string[];
    reasons: string[];
  };
  documents: WorkerDocumentSummaryResponse[];
  skills: WorkerSkillSummaryResponse[];
  affiliations: WorkerAffiliationSummaryResponse[];
  availability: {
    isOnline: boolean;
    isBusy: boolean;
    currentLatitude: number | null;
    currentLongitude: number | null;
    lastHeartbeatAt: string | null;
  } | null;
}

// ============================================================================
// Worker Admin Governance Service
// ============================================================================

export class WorkerAdminGovernanceService {
  constructor(
    private governanceRepo: WorkerAdminGovernanceRepository = workerAdminGovernanceRepository,
    private profileRepo: WorkerProfileRepository = new WorkerProfileRepository(),
    private documentRepo: WorkerDocumentRepository = new WorkerDocumentRepository(),
    private skillRepo: WorkerSkillRepository = new WorkerSkillRepository(),
    private availabilityRepo: WorkerAvailabilityRepository = new WorkerAvailabilityRepository(),
    private kycValidator: WorkerKycValidationService = workerKycValidationService
  ) {}

  /**
   * Asserts that the actor possesses valid administrative privileges (ADMIN or SUPER_ADMIN).
   * Validates both callerRole string context and persistent database role assignments.
   */
  public async assertAdmin(
    adminUserIdInput: bigint | string,
    callerRole?: string
  ): Promise<bigint> {
    const adminUserId = BigInt(adminUserIdInput);

    if (callerRole && callerRole !== 'ADMIN' && callerRole !== 'SUPER_ADMIN') {
      throw new ForbiddenError(
        'Access denied: Only platform administrators can perform worker governance operations.'
      );
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: adminUserId },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!adminUser) {
      throw new ForbiddenError('Administrator account not found.');
    }

    if (adminUser.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError('Administrator account is not active.');
    }

    const hasAdminRole = adminUser.userRoles.some(
      (ur) => ur.role.roleName === 'ADMIN' || ur.role.roleName === 'SUPER_ADMIN'
    );

    if (!hasAdminRole) {
      throw new ForbiddenError(
        'Access denied: User does not possess an administrative role (ADMIN or SUPER_ADMIN).'
      );
    }

    return adminUserId;
  }

  /**
   * Serializes a worker profile and relations into an API-safe summary.
   */
  private serializeApplicationSummary(profile: any): WorkerApplicationSummaryResponse {
    const user = profile.user;
    const city = profile.primaryCity;
    const docs = profile.documents || [];
    const skills = profile.skills || [];

    const unverifiedDocCount = docs.filter(
      (d: any) => d.verificationStatus === 'PENDING'
    ).length;

    return {
      id: profile.id.toString(),
      userId: profile.userId.toString(),
      mobileNumber: user?.mobileNumber || '',
      email: user?.email || null,
      accountStatus: user?.accountStatus || 'ACTIVE',
      firstName: profile.firstName,
      lastName: profile.lastName,
      workerType: profile.workerType,
      experienceYears: profile.experienceYears,
      primaryCityId: profile.primaryCityId ? profile.primaryCityId.toString() : null,
      primaryCityName: city?.cityName || null,
      submissionStatus: profile.submissionStatus,
      approvalStatus: profile.approvalStatus,
      documentCount: docs.length,
      unverifiedDocumentCount: unverifiedDocCount,
      skillCount: skills.length,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  /**
   * Serializes complete worker application dossier with evaluated KYC and zero-grace-day calendar metrics.
   * NEVER exposes storage paths or internal keys.
   */
  private serializeDossier(
    profile: any,
    kycResult: WorkerKycValidationResult
  ): WorkerGovernanceDossierResponse {
    const user = profile.user;
    const city = profile.primaryCity;

    const serializedDocs: WorkerDocumentSummaryResponse[] = (profile.documents || []).map(
      (doc: any) => {
        const expiryEval = DateUtil.evaluateCalendarExpiry(doc.expiryDate);

        return {
          id: doc.id.toString(),
          documentType: doc.documentType,
          originalName: doc.originalName || null,
          mimeType: doc.mimeType || null,
          fileSizeBytes: doc.fileSizeBytes ? doc.fileSizeBytes.toString() : null,
          verificationStatus: doc.verificationStatus,
          rejectionReason: doc.rejectionReason || null,
          expiryDate: doc.expiryDate ? doc.expiryDate.toISOString().split('T')[0] : null,
          isExpired: expiryEval.isExpired,
          daysUntilExpiry: expiryEval.daysRemaining,
          reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
          reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
          uploadedAt: doc.uploadedAt ? doc.uploadedAt.toISOString() : new Date().toISOString(),
        };
      }
    );

    const serializedSkills: WorkerSkillSummaryResponse[] = (profile.skills || []).map(
      (skill: any) => ({
        id: skill.id.toString(),
        serviceCategoryId: skill.serviceCategoryId.toString(),
        categoryCode: skill.serviceCategory?.categoryCode || '',
        categoryName: skill.serviceCategory?.categoryName || '',
        experienceYears: skill.experienceYears,
        verificationStatus: skill.verificationStatus,
        rejectionReason: skill.rejectionReason || null,
        isActive: skill.isActive,
      })
    );

    const serializedAffiliations: WorkerAffiliationSummaryResponse[] = (
      profile.affiliations || []
    ).map((aff: any) => ({
      id: aff.id.toString(),
      partnerId: aff.partnerId.toString(),
      partnerBusinessName:
        aff.partner?.businessName || aff.partner?.legalName || 'Unknown Partner',
      profileType: aff.partner?.profileType || 'INDIVIDUAL',
      affiliationStatus: aff.affiliationStatus,
      affiliatedAt: aff.affiliatedAt.toISOString(),
      terminatedAt: aff.terminatedAt ? aff.terminatedAt.toISOString() : null,
    }));

    const availability = profile.availability
      ? {
          isOnline: profile.availability.isOnline,
          isBusy: profile.availability.isBusy,
          currentLatitude: profile.availability.currentLatitude
            ? Number(profile.availability.currentLatitude)
            : null,
          currentLongitude: profile.availability.currentLongitude
            ? Number(profile.availability.currentLongitude)
            : null,
          lastHeartbeatAt: profile.availability.lastHeartbeatAt
            ? profile.availability.lastHeartbeatAt.toISOString()
            : null,
        }
      : null;

    return {
      id: profile.id.toString(),
      userId: profile.userId.toString(),
      mobileNumber: user?.mobileNumber || '',
      email: user?.email || null,
      accountStatus: user?.accountStatus || 'ACTIVE',
      isMobileVerified: user?.isMobileVerified ?? false,
      firstName: profile.firstName,
      lastName: profile.lastName,
      dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.toISOString().split('T')[0] : null,
      gender: profile.gender,
      profileImageUrl: profile.profileImageUrl,
      bio: profile.bio,
      workerType: profile.workerType,
      experienceYears: profile.experienceYears,
      primaryCityId: profile.primaryCityId ? profile.primaryCityId.toString() : null,
      primaryCityName: city?.cityName || null,
      approvalStatus: profile.approvalStatus,
      rejectionReason: profile.rejectionReason,
      submissionStatus: profile.submissionStatus,
      submittedAt: profile.submittedAt ? profile.submittedAt.toISOString() : null,
      suspendedAt: profile.suspendedAt ? profile.suspendedAt.toISOString() : null,
      suspensionReason: profile.suspensionReason,
      reviewedBy: profile.reviewedBy ? profile.reviewedBy.toString() : null,
      reviewedAt: profile.reviewedAt ? profile.reviewedAt.toISOString() : null,
      isActive: profile.isActive,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      kycEvaluation: {
        isValid: kycResult.isValid,
        missingDocuments: kycResult.missingDocuments,
        unverifiedDocuments: kycResult.unverifiedDocuments,
        expiredDocuments: kycResult.expiredDocuments,
        expiringSoonDocuments: kycResult.expiringSoonDocuments,
        missingSkills: kycResult.missingSkills,
        unverifiedSkills: kycResult.unverifiedSkills,
        reasons: kycResult.reasons,
      },
      documents: serializedDocs,
      skills: serializedSkills,
      affiliations: serializedAffiliations,
      availability,
    };
  }

  // ==========================================================================
  // 1. Worker Application Review
  // ==========================================================================

  /**
   * Retrieves paginated worker applications for administrative queue review.
   */
  public async listWorkerApplications(
    adminUserIdInput: bigint | string,
    filter?: WorkerApplicationFilter,
    options?: PaginationOptions,
    callerRole?: string
  ): Promise<PaginatedResult<WorkerApplicationSummaryResponse>> {
    await this.assertAdmin(adminUserIdInput, callerRole);

    const repoFilter = {
      approvalStatus: filter?.approvalStatus,
      submissionStatus: filter?.submissionStatus,
      workerType: filter?.workerType,
      primaryCityId: filter?.primaryCityId ? BigInt(filter.primaryCityId) : undefined,
      isActive: filter?.isActive,
      search: filter?.search,
    };

    const result = await this.governanceRepo.findApplications(repoFilter, options);

    return {
      items: result.items.map((p: any) => this.serializeApplicationSummary(p)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Retrieves complete worker dossier with real-time evaluated KYC compliance.
   * Guarantees strict IDOR protection and zero sensitive key leakage.
   */
  public async getWorkerApplicationDetails(
    adminUserIdInput: bigint | string,
    workerIdInput: bigint | string,
    callerRole?: string
  ): Promise<WorkerGovernanceDossierResponse> {
    await this.assertAdmin(adminUserIdInput, callerRole);
    const workerId = BigInt(workerIdInput);

    const dossier = await this.governanceRepo.findGovernanceDossier(workerId);
    if (!dossier) {
      throw new NotFoundError(`Worker application with ID ${workerId.toString()} not found.`);
    }

    const kycResult = await this.kycValidator.validateWorkerWithRepository(workerId);

    return this.serializeDossier(dossier, kycResult);
  }

  // ==========================================================================
  // 2. Worker Approval
  // ==========================================================================

  /**
   * Approves a worker onboarding application.
   *
   * Fail-Closed Security Guarantees:
   * 1. Administrator authorization assertion.
   * 2. Self-approval prevention (Admin cannot approve their own worker profile).
   * 3. Profile existence check.
   * 4. Duplicate approval check (Cannot approve an already APPROVED profile).
   * 5. Submission check: profile must be in SUBMITTED or UNDER_REVIEW (cannot approve DRAFT).
   * 6. Mandatory KYC policy gate: must pass all required documents, non-expired, and verified skills.
   * 7. Atomically transitions approvalStatus to APPROVED, provisions offline availability, and records AuditLog.
   * 8. Does NOT automatically set the worker online.
   */
  public async approveWorker(
    adminUserIdInput: bigint | string,
    workerIdInput: bigint | string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string,
    policyParams?: WorkerKycPolicyParams
  ): Promise<WorkerGovernanceDossierResponse> {
    const adminUserId = await this.assertAdmin(adminUserIdInput, callerRole);
    const workerId = BigInt(workerIdInput);

    const worker = await this.profileRepo.findById(workerId);
    if (!worker) {
      throw new NotFoundError(`Worker profile with ID ${workerId.toString()} not found.`);
    }

    // 1. Self-approval guard
    if (worker.userId === adminUserId) {
      throw new ForbiddenError('Platform security policy: Administrators cannot approve their own worker profile.');
    }

    // 2. Duplicate approval check
    if (worker.approvalStatus === 'APPROVED') {
      throw new BadRequestError('Worker profile is already approved.');
    }

    // 3. Submission state check
    if (worker.submissionStatus === 'DRAFT') {
      throw new BadRequestError(
        "Cannot approve worker profile in 'DRAFT' status. Worker must submit application for review first."
      );
    }

    // 4. Fail-closed KYC validation gatekeeper
    const kycResult = await this.kycValidator.validateWorkerWithRepository(workerId, policyParams);
    if (!kycResult.isValid) {
      logger.warn(
        `[Worker Admin] Approval blocked for worker ${workerId.toString()} due to KYC policy failure: ${kycResult.reasons.join('; ')}`
      );
      throw new BadRequestError(
        `Worker approval blocked by KYC policy: ${kycResult.reasons.join('; ')}`
      );
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // 5. Atomic state update
      await this.governanceRepo.atomicApprove(workerId, adminUserId, now, tx);

      // 6. Upsert availability record guaranteeing offline status
      await this.availabilityRepo.upsertAvailability(
        workerId,
        {
          isOnline: false,
          isBusy: false,
        },
        tx
      );

      // 7. Transactional immutable audit log
      await this.governanceRepo.recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'WORKER_ADMIN_APPROVED',
          entityName: 'WorkerProfile',
          entityId: workerId,
          oldValues: {
            approvalStatus: worker.approvalStatus,
            submissionStatus: worker.submissionStatus,
          },
          newValues: {
            approvalStatus: 'APPROVED',
            submissionStatus: 'APPROVED',
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
        tx
      );
    });

    logger.info(
      `[Worker Admin] Worker ${workerId.toString()} APPROVED by admin ${adminUserId.toString()}`
    );

    return this.getWorkerApplicationDetails(adminUserId, workerId, callerRole);
  }

  // ==========================================================================
  // 3. Worker Rejection
  // ==========================================================================

  /**
   * Rejects a worker onboarding application with mandatory rejection justification.
   *
   * Business Rules:
   * 1. Mandatory non-empty rejection reason.
   * 2. Self-rejection prevention.
   * 3. Prevents invalid repeated transitions.
   * 4. Forces worker offline if previously online.
   * 5. Preserves application history and enables controlled resubmission.
   * 6. Transactional immutable audit logging.
   */
  public async rejectWorker(
    adminUserIdInput: bigint | string,
    workerIdInput: bigint | string,
    reason: string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string
  ): Promise<WorkerGovernanceDossierResponse> {
    const adminUserId = await this.assertAdmin(adminUserIdInput, callerRole);
    const workerId = BigInt(workerIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Rejection reason is mandatory.');
    }

    const worker = await this.profileRepo.findById(workerId);
    if (!worker) {
      throw new NotFoundError(`Worker profile with ID ${workerId.toString()} not found.`);
    }

    // 1. Self-approval guard
    if (worker.userId === adminUserId) {
      throw new ForbiddenError('Platform security policy: Administrators cannot reject their own worker profile.');
    }

    // 2. Prevent repeated rejection
    if (worker.approvalStatus === 'REJECTED' && worker.submissionStatus === 'REJECTED') {
      throw new BadRequestError('Worker profile is already in REJECTED status.');
    }

    const now = new Date();
    const sanitizedReason = reason.trim().slice(0, 1000);

    await prisma.$transaction(async (tx) => {
      // 3. Atomic state update
      await this.governanceRepo.atomicReject(workerId, adminUserId, sanitizedReason, now, tx);

      // 4. Force offline
      await this.availabilityRepo.updateDutyStatus(workerId, false, false, tx);

      // 5. Transactional immutable audit log
      await this.governanceRepo.recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'WORKER_ADMIN_REJECTED',
          entityName: 'WorkerProfile',
          entityId: workerId,
          oldValues: {
            approvalStatus: worker.approvalStatus,
            submissionStatus: worker.submissionStatus,
          },
          newValues: {
            approvalStatus: 'REJECTED',
            submissionStatus: 'REJECTED',
            rejectionReason: sanitizedReason,
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
        tx
      );
    });

    logger.info(
      `[Worker Admin] Worker ${workerId.toString()} REJECTED by admin ${adminUserId.toString()}`
    );

    return this.getWorkerApplicationDetails(adminUserId, workerId, callerRole);
  }

  // ==========================================================================
  // 4. Worker Suspension
  // ==========================================================================

  /**
   * Suspends an approved worker profile with mandatory suspension reason.
   *
   * Business Rules:
   * 1. Mandatory non-empty suspension reason.
   * 2. Self-suspension prevention.
   * 3. Only APPROVED workers can be suspended.
   * 4. Prevents duplicate suspension transitions.
   * 5. Immediately forces the worker offline in the database.
   * 6. Preserves existing partner affiliations (does NOT delete or terminate them).
   * 7. Heartbeat updates cannot reactivate a suspended worker.
   * 8. Transactional immutable audit log.
   */
  public async suspendWorker(
    adminUserIdInput: bigint | string,
    workerIdInput: bigint | string,
    reason: string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string
  ): Promise<WorkerGovernanceDossierResponse> {
    const adminUserId = await this.assertAdmin(adminUserIdInput, callerRole);
    const workerId = BigInt(workerIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Suspension reason is mandatory.');
    }

    const worker = await this.profileRepo.findById(workerId);
    if (!worker) {
      throw new NotFoundError(`Worker profile with ID ${workerId.toString()} not found.`);
    }

    // 1. Self-suspension guard
    if (worker.userId === adminUserId) {
      throw new ForbiddenError('Platform security policy: Administrators cannot suspend their own worker profile.');
    }

    // 2. Prevent repeated suspension
    if (worker.approvalStatus === 'SUSPENDED') {
      throw new ConflictError('Worker profile is already suspended.');
    }

    // 3. Status eligibility check
    if (worker.approvalStatus !== 'APPROVED') {
      throw new BadRequestError(
        `Only APPROVED worker profiles can be suspended (current status: '${worker.approvalStatus}').`
      );
    }

    const now = new Date();
    const sanitizedReason = reason.trim().slice(0, 1000);

    await prisma.$transaction(async (tx) => {
      // 4. Atomic update to SUSPENDED
      await this.governanceRepo.atomicSuspend(workerId, adminUserId, sanitizedReason, now, tx);

      // 5. Force availability offline immediately
      await this.availabilityRepo.updateDutyStatus(workerId, false, false, tx);

      // 6. Transactional immutable audit log
      await this.governanceRepo.recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'WORKER_ADMIN_SUSPENDED',
          entityName: 'WorkerProfile',
          entityId: workerId,
          oldValues: {
            approvalStatus: worker.approvalStatus,
            suspendedAt: worker.suspendedAt ? worker.suspendedAt.toISOString() : null,
          },
          newValues: {
            approvalStatus: 'SUSPENDED',
            suspensionReason: sanitizedReason,
            suspendedAt: now.toISOString(),
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
        tx
      );
    });

    logger.info(
      `[Worker Admin] Worker ${workerId.toString()} SUSPENDED by admin ${adminUserId.toString()}`
    );

    return this.getWorkerApplicationDetails(adminUserId, workerId, callerRole);
  }

  // ==========================================================================
  // 5. Worker Reactivation
  // ==========================================================================

  /**
   * Reactivates a suspended worker profile.
   *
   * Business Rules:
   * 1. Administrator authorization assertion.
   * 2. Self-reactivation prevention.
   * 3. Only SUSPENDED workers can be reactivated.
   * 4. Identity consistency: User account must be ACTIVE. Cannot bypass a blocked/inactive user account.
   * 5. Reactivation restores APPROVED status, but worker strictly REMAINS OFFLINE.
   * 6. Revalidation of KYC eligibility is required when worker later attempts to go online.
   * 7. Transactional immutable audit logging.
   */
  public async reactivateWorker(
    adminUserIdInput: bigint | string,
    workerIdInput: bigint | string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string
  ): Promise<WorkerGovernanceDossierResponse> {
    const adminUserId = await this.assertAdmin(adminUserIdInput, callerRole);
    const workerId = BigInt(workerIdInput);

    const worker = await this.profileRepo.findById(workerId);
    if (!worker) {
      throw new NotFoundError(`Worker profile with ID ${workerId.toString()} not found.`);
    }

    // 1. Self-reactivation guard
    if (worker.userId === adminUserId) {
      throw new ForbiddenError('Platform security policy: Administrators cannot reactivate their own worker profile.');
    }

    // 2. Status eligibility check
    if (worker.approvalStatus !== 'SUSPENDED') {
      throw new BadRequestError(
        `Only SUSPENDED worker profiles can be reactivated (current status: '${worker.approvalStatus}').`
      );
    }

    // 3. User account identity consistency check
    const user = await prisma.user.findUnique({
      where: { id: worker.userId },
      select: { accountStatus: true },
    });

    if (!user || user.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError(
        `Cannot reactivate worker: Associated user account status is '${user?.accountStatus || 'UNKNOWN'}'. User account must be ACTIVE.`
      );
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // 4. Restore approval status to APPROVED and clear suspension metadata
      await this.governanceRepo.atomicReactivate(workerId, adminUserId, 'APPROVED', now, tx);

      // 5. Ensure worker availability remains offline until worker explicitly toggles online
      await this.availabilityRepo.updateDutyStatus(workerId, false, false, tx);

      // 6. Transactional immutable audit log
      await this.governanceRepo.recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'WORKER_ADMIN_REACTIVATED',
          entityName: 'WorkerProfile',
          entityId: workerId,
          oldValues: {
            approvalStatus: 'SUSPENDED',
            suspendedAt: worker.suspendedAt ? worker.suspendedAt.toISOString() : null,
            suspensionReason: worker.suspensionReason,
          },
          newValues: {
            approvalStatus: 'APPROVED',
            suspendedAt: null,
            suspensionReason: null,
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
        tx
      );
    });

    logger.info(
      `[Worker Admin] Worker ${workerId.toString()} REACTIVATED by admin ${adminUserId.toString()}`
    );

    return this.getWorkerApplicationDetails(adminUserId, workerId, callerRole);
  }

  // ==========================================================================
  // 6. Administrative Document & Skill KYC Verification
  // ==========================================================================

  /**
   * Verifies an uploaded worker document with atomic audit logging.
   */
  public async verifyWorkerDocument(
    adminUserIdInput: bigint | string,
    docIdInput: bigint | string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string
  ): Promise<WorkerDocumentSummaryResponse> {
    const adminUserId = await this.assertAdmin(adminUserIdInput, callerRole);
    const docId = BigInt(docIdInput);

    const doc = await this.documentRepo.findById(docId);
    if (!doc) {
      throw new NotFoundError(`Worker document with ID ${docId.toString()} not found.`);
    }

    const worker = await this.profileRepo.findById(doc.workerId);
    if (worker && worker.userId === adminUserId) {
      throw new ForbiddenError('Administrators cannot verify documents for their own worker profile.');
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDoc = await this.documentRepo.updateVerificationStatus(
        docId,
        {
          verificationStatus: 'VERIFIED',
          reviewedBy: adminUserId,
          reviewedAt: now,
          rejectionReason: null,
        },
        tx
      );

      await this.governanceRepo.recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'WORKER_DOCUMENT_VERIFIED',
          entityName: 'WorkerDocument',
          entityId: docId,
          oldValues: {
            verificationStatus: doc.verificationStatus,
          },
          newValues: {
            verificationStatus: 'VERIFIED',
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
        tx
      );

      return updatedDoc;
    });

    const expiryEval = DateUtil.evaluateCalendarExpiry(updated.expiryDate);

    return {
      id: updated.id.toString(),
      documentType: updated.documentType,
      originalName: updated.originalName,
      mimeType: updated.mimeType,
      fileSizeBytes: updated.fileSizeBytes ? updated.fileSizeBytes.toString() : null,
      verificationStatus: updated.verificationStatus,
      rejectionReason: updated.rejectionReason,
      expiryDate: updated.expiryDate ? updated.expiryDate.toISOString().split('T')[0] : null,
      isExpired: expiryEval.isExpired,
      daysUntilExpiry: expiryEval.daysRemaining,
      reviewedBy: updated.reviewedBy ? updated.reviewedBy.toString() : null,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
      uploadedAt: updated.uploadedAt.toISOString(),
    };
  }

  /**
   * Rejects an uploaded worker document with mandatory reason and atomic audit logging.
   */
  public async rejectWorkerDocument(
    adminUserIdInput: bigint | string,
    docIdInput: bigint | string,
    reason: string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string
  ): Promise<WorkerDocumentSummaryResponse> {
    const adminUserId = await this.assertAdmin(adminUserIdInput, callerRole);
    const docId = BigInt(docIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Document rejection reason is mandatory.');
    }

    const doc = await this.documentRepo.findById(docId);
    if (!doc) {
      throw new NotFoundError(`Worker document with ID ${docId.toString()} not found.`);
    }

    const worker = await this.profileRepo.findById(doc.workerId);
    if (worker && worker.userId === adminUserId) {
      throw new ForbiddenError('Administrators cannot reject documents for their own worker profile.');
    }

    const now = new Date();
    const sanitizedReason = reason.trim().slice(0, 1000);

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDoc = await this.documentRepo.updateVerificationStatus(
        docId,
        {
          verificationStatus: 'REJECTED',
          reviewedBy: adminUserId,
          reviewedAt: now,
          rejectionReason: sanitizedReason,
        },
        tx
      );

      await this.governanceRepo.recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'WORKER_DOCUMENT_REJECTED',
          entityName: 'WorkerDocument',
          entityId: docId,
          oldValues: {
            verificationStatus: doc.verificationStatus,
          },
          newValues: {
            verificationStatus: 'REJECTED',
            rejectionReason: sanitizedReason,
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
        tx
      );

      return updatedDoc;
    });

    const expiryEval = DateUtil.evaluateCalendarExpiry(updated.expiryDate);

    return {
      id: updated.id.toString(),
      documentType: updated.documentType,
      originalName: updated.originalName,
      mimeType: updated.mimeType,
      fileSizeBytes: updated.fileSizeBytes ? updated.fileSizeBytes.toString() : null,
      verificationStatus: updated.verificationStatus,
      rejectionReason: updated.rejectionReason,
      expiryDate: updated.expiryDate ? updated.expiryDate.toISOString().split('T')[0] : null,
      isExpired: expiryEval.isExpired,
      daysUntilExpiry: expiryEval.daysRemaining,
      reviewedBy: updated.reviewedBy ? updated.reviewedBy.toString() : null,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
      uploadedAt: updated.uploadedAt.toISOString(),
    };
  }

  /**
   * Verifies an uploaded worker skill with atomic audit logging.
   */
  public async verifyWorkerSkill(
    adminUserIdInput: bigint | string,
    skillIdInput: bigint | string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string
  ): Promise<WorkerSkillSummaryResponse> {
    const adminUserId = await this.assertAdmin(adminUserIdInput, callerRole);
    const skillId = BigInt(skillIdInput);

    const skill = await this.skillRepo.findById(skillId);
    if (!skill) {
      throw new NotFoundError(`Worker skill with ID ${skillId.toString()} not found.`);
    }

    const worker = await this.profileRepo.findById(skill.workerId);
    if (worker && worker.userId === adminUserId) {
      throw new ForbiddenError('Administrators cannot verify skills for their own worker profile.');
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const updatedSkill = await this.skillRepo.updateVerificationStatus(
        skillId,
        {
          verificationStatus: 'VERIFIED',
          reviewedBy: adminUserId,
          reviewedAt: now,
          rejectionReason: null,
        },
        tx
      );

      await this.governanceRepo.recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'WORKER_SKILL_VERIFIED',
          entityName: 'WorkerSkill',
          entityId: skillId,
          oldValues: {
            verificationStatus: skill.verificationStatus,
          },
          newValues: {
            verificationStatus: 'VERIFIED',
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
        tx
      );

      return updatedSkill;
    });

    const category = await prisma.serviceCategory.findUnique({
      where: { id: updated.serviceCategoryId },
    });

    return {
      id: updated.id.toString(),
      serviceCategoryId: updated.serviceCategoryId.toString(),
      categoryCode: category?.categoryCode || '',
      categoryName: category?.categoryName || '',
      experienceYears: updated.experienceYears,
      verificationStatus: updated.verificationStatus,
      rejectionReason: updated.rejectionReason,
      isActive: updated.isActive,
    };
  }

  /**
   * Rejects an uploaded worker skill with mandatory reason and atomic audit logging.
   */
  public async rejectWorkerSkill(
    adminUserIdInput: bigint | string,
    skillIdInput: bigint | string,
    reason: string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string
  ): Promise<WorkerSkillSummaryResponse> {
    const adminUserId = await this.assertAdmin(adminUserIdInput, callerRole);
    const skillId = BigInt(skillIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Skill rejection reason is mandatory.');
    }

    const skill = await this.skillRepo.findById(skillId);
    if (!skill) {
      throw new NotFoundError(`Worker skill with ID ${skillId.toString()} not found.`);
    }

    const worker = await this.profileRepo.findById(skill.workerId);
    if (worker && worker.userId === adminUserId) {
      throw new ForbiddenError('Administrators cannot reject skills for their own worker profile.');
    }

    const now = new Date();
    const sanitizedReason = reason.trim().slice(0, 1000);

    const updated = await prisma.$transaction(async (tx) => {
      const updatedSkill = await this.skillRepo.updateVerificationStatus(
        skillId,
        {
          verificationStatus: 'REJECTED',
          reviewedBy: adminUserId,
          reviewedAt: now,
          rejectionReason: sanitizedReason,
        },
        tx
      );

      await this.governanceRepo.recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'WORKER_SKILL_REJECTED',
          entityName: 'WorkerSkill',
          entityId: skillId,
          oldValues: {
            verificationStatus: skill.verificationStatus,
          },
          newValues: {
            verificationStatus: 'REJECTED',
            rejectionReason: sanitizedReason,
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
        tx
      );

      return updatedSkill;
    });

    const category = await prisma.serviceCategory.findUnique({
      where: { id: updated.serviceCategoryId },
    });

    return {
      id: updated.id.toString(),
      serviceCategoryId: updated.serviceCategoryId.toString(),
      categoryCode: category?.categoryCode || '',
      categoryName: category?.categoryName || '',
      experienceYears: updated.experienceYears,
      verificationStatus: updated.verificationStatus,
      rejectionReason: updated.rejectionReason,
      isActive: updated.isActive,
    };
  }
}

// Default singleton export
export const workerAdminGovernanceService = new WorkerAdminGovernanceService();
