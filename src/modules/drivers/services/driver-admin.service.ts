import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../../common/errors';
import {
  storageService,
  IStorageService,
} from '../../../common/services/storage.service';
import {
  driverProfileRepository,
  DriverProfileRepository,
} from '../repositories/driver-profile.repository';
import {
  driverDocumentRepository,
  DriverDocumentRepository,
} from '../repositories/driver-document.repository';
import {
  driverPartnerAffiliationRepository,
  DriverPartnerAffiliationRepository,
} from '../repositories/driver-partner-affiliation.repository';
import {
  driverVehicleAssignmentRepository,
  DriverVehicleAssignmentRepository,
} from '../repositories/driver-vehicle-assignment.repository';
import {
  driverAvailabilityRepository,
  DriverAvailabilityRepository,
} from '../repositories/driver-availability.repository';
import {
  driverKycValidationService,
  DriverKycValidationService,
} from './driver-kyc.service';
import { DateUtil } from '../../../common/utils/date.util';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface AdminClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface DriverDossierResponse {
  id: string;
  userId: string;
  mobileNumber: string;
  email: string | null;
  accountStatus: string;
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
  rejectionReason: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  kycEvaluation: {
    isValid: boolean;
    missingTypes: string[];
    expiredTypes: string[];
    unverifiedTypes: string[];
    incompatibleLicenceClasses: string[];
    reasons: string[];
  };
  documents: Array<{
    id: string;
    documentType: string;
    documentNumber: string | null;
    verificationStatus: string;
    rejectionReason: string | null;
    expiryDate: string | null;
    isExpired: boolean;
    daysUntilExpiry: number | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    uploadedAt: string;
  }>;
  affiliations: Array<{
    id: string;
    partnerId: string;
    partnerBusinessName: string;
    affiliationStatus: string;
    affiliatedAt: string;
    terminatedAt: string | null;
  }>;
  assignmentsSummary: {
    totalAssignments: number;
    activeAssignments: number;
    completedAssignments: number;
  };
}

// ============================================================================
// Driver Admin Verification & Approval Service
// ============================================================================

export class DriverAdminService {
  constructor(
    private profileRepo: DriverProfileRepository = driverProfileRepository,
    private documentRepo: DriverDocumentRepository = driverDocumentRepository,
    private affiliationRepo: DriverPartnerAffiliationRepository = driverPartnerAffiliationRepository,
    private assignmentRepo: DriverVehicleAssignmentRepository = driverVehicleAssignmentRepository,
    private availabilityRepo: DriverAvailabilityRepository = driverAvailabilityRepository,
    private kycValidator: DriverKycValidationService = driverKycValidationService,
    private storage: IStorageService = storageService
  ) {}

  /**
   * List pending driver applications awaiting review.
   */
  public async getPendingDrivers(options?: { page?: number; limit?: number }) {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));

    const result = await this.profileRepo.findMany(
      {
        submissionStatus: 'SUBMITTED',
        approvalStatus: 'PENDING',
      },
      { page, limit, sortBy: 'createdAt', sortOrder: 'asc' }
    );

    const enrichedItems = await Promise.all(
      result.items.map(async (p) => {
        const user = await prisma.user.findUnique({
          where: { id: p.userId },
          select: { mobileNumber: true, email: true, accountStatus: true },
        });

        const latestDocs = await this.documentRepo.findLatestByDriver(p.id);

        return {
          id: p.id.toString(),
          userId: p.userId.toString(),
          mobileNumber: user?.mobileNumber || '',
          email: user?.email || null,
          accountStatus: user?.accountStatus || 'ACTIVE',
          firstName: p.firstName,
          lastName: p.lastName,
          licenceClasses: p.licenceClasses,
          experienceYears: p.experienceYears,
          submissionStatus: p.submissionStatus,
          approvalStatus: p.approvalStatus,
          documentCount: latestDocs.length,
          unverifiedDocumentCount: latestDocs.filter((d) => d.verificationStatus === 'PENDING').length,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        };
      })
    );

    return {
      items: enrichedItems,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Retrieve complete driver verification dossier with KYC evaluation.
   */
  public async getDriverDossier(driverIdInput: bigint | string): Promise<DriverDossierResponse> {
    const driverId = BigInt(driverIdInput);
    const profile = await this.profileRepo.findById(driverId);

    if (!profile) {
      throw new NotFoundError(`Driver profile with ID ${driverId.toString()} not found.`);
    }

    const user = await prisma.user.findUnique({
      where: { id: profile.userId },
      select: { mobileNumber: true, email: true, accountStatus: true },
    });

    // 1. Fetch latest documents
    const latestDocs = await this.documentRepo.findLatestByDriver(driverId);
    const serializedDocs = latestDocs.map((doc: any) => {
      const expiryEval = DateUtil.evaluateCalendarExpiry(doc.expiryDate);

      return {
        id: doc.id.toString(),
        documentType: doc.documentType,
        documentNumber: (doc.documentMetadata as any)?.documentNumber || null,
        verificationStatus: doc.verificationStatus,
        rejectionReason: doc.rejectionReason,
        expiryDate: doc.expiryDate ? doc.expiryDate.toISOString().split('T')[0] : null,
        isExpired: expiryEval.isExpired,
        daysUntilExpiry: expiryEval.daysRemaining,
        reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
        reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
        uploadedAt: doc.uploadedAt ? doc.uploadedAt.toISOString() : new Date().toISOString(),
      };
    });

    // 2. Fetch affiliations
    const affiliations = await this.affiliationRepo.listActiveByDriver(driverId);
    const serializedAffiliations = await Promise.all(
      affiliations.map(async (aff) => {
        const partner = await prisma.partnerProfile.findUnique({
          where: { id: aff.partnerId },
          select: { businessName: true, legalName: true },
        });
        return {
          id: aff.id.toString(),
          partnerId: aff.partnerId.toString(),
          partnerBusinessName: partner?.businessName || partner?.legalName || 'Unknown Fleet',
          affiliationStatus: aff.affiliationStatus,
          affiliatedAt: aff.affiliatedAt.toISOString(),
          terminatedAt: aff.terminatedAt ? aff.terminatedAt.toISOString() : null,
        };
      })
    );

    // 3. KYC evaluation
    const kycResult = await this.kycValidator.validateDriverWithRepository(driverId);

    // 4. Assignments summary
    const [totalAssignments, activeAssignments, completedAssignments] = await Promise.all([
      prisma.driverVehicleAssignment.count({ where: { driverId } }),
      prisma.driverVehicleAssignment.count({ where: { driverId, assignmentStatus: 'ACTIVE' } }),
      prisma.driverVehicleAssignment.count({ where: { driverId, assignmentStatus: 'COMPLETED' } }),
    ]);

    return {
      id: profile.id.toString(),
      userId: profile.userId.toString(),
      mobileNumber: user?.mobileNumber || '',
      email: user?.email || null,
      accountStatus: user?.accountStatus || 'ACTIVE',
      firstName: profile.firstName,
      lastName: profile.lastName,
      dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.toISOString().split('T')[0] : null,
      gender: profile.gender,
      profileImageUrl: profile.profileImageUrl,
      bio: profile.bio,
      experienceYears: profile.experienceYears,
      licenceNumber: profile.licenceNumber,
      licenceClasses: profile.licenceClasses,
      licenceExpiryDate: profile.licenceExpiryDate
        ? profile.licenceExpiryDate.toISOString().split('T')[0]
        : null,
      issuingAuthority: profile.issuingAuthority,
      submissionStatus: profile.submissionStatus,
      approvalStatus: profile.approvalStatus,
      rejectionReason: profile.rejectionReason,
      suspendedAt: profile.suspendedAt ? profile.suspendedAt.toISOString() : null,
      suspensionReason: profile.suspensionReason,
      reviewedBy: profile.reviewedBy ? profile.reviewedBy.toString() : null,
      reviewedAt: profile.reviewedAt ? profile.reviewedAt.toISOString() : null,
      isActive: profile.isActive,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      kycEvaluation: {
        isValid: kycResult.isValid,
        missingTypes: kycResult.missingTypes,
        expiredTypes: kycResult.expiredTypes,
        unverifiedTypes: kycResult.unverifiedTypes,
        incompatibleLicenceClasses: kycResult.incompatibleLicenceClasses,
        reasons: kycResult.reasons,
      },
      documents: serializedDocs,
      affiliations: serializedAffiliations,
      assignmentsSummary: {
        totalAssignments,
        activeAssignments,
        completedAssignments,
      },
    };
  }

  /**
   * Securely stream a private driver document file for administrative inspection.
   */
  public async getDocumentFileForAdmin(
    docIdInput: bigint | string
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const docId = BigInt(docIdInput);
    const doc = await this.documentRepo.findById(docId);

    if (!doc) {
      throw new NotFoundError(`Driver document with ID ${docId.toString()} not found.`);
    }

    return this.storage.getFile(doc.documentStorageKey);
  }

  /**
   * Verify an individual driver document with atomic audit log.
   */
  public async verifyDriverDocument(
    docIdInput: bigint | string,
    adminUserIdInput: bigint | string,
    clientInfo: AdminClientInfo = {}
  ) {
    const docId = BigInt(docIdInput);
    const adminUserId = BigInt(adminUserIdInput);

    const doc = await this.documentRepo.findById(docId);
    if (!doc) {
      throw new NotFoundError(`Driver document with ID ${docId.toString()} not found.`);
    }

    const driver = await this.profileRepo.findById(doc.driverId);
    if (!driver) {
      throw new NotFoundError('Associated driver profile not found.');
    }

    // Self-approval guard
    if (driver.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot verify documents for their own driver profile.');
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDoc = await tx.driverDocument.update({
        where: { id: docId },
        data: {
          verificationStatus: 'VERIFIED',
          rejectionReason: null,
          reviewedBy: adminUserId,
          reviewedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'DRIVER_DOCUMENT_VERIFIED',
          entityName: 'driver_documents',
          entityId: docId,
          newValues: {
            verificationStatus: 'VERIFIED',
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
      });

      return updatedDoc;
    });

    logger.info(`[Driver Admin] Document ${docId.toString()} VERIFIED by admin ${adminUserId.toString()}`);

    return {
      id: updated.id.toString(),
      driverId: updated.driverId.toString(),
      documentType: updated.documentType,
      verificationStatus: updated.verificationStatus,
      reviewedBy: updated.reviewedBy ? updated.reviewedBy.toString() : null,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
    };
  }

  /**
   * Reject an individual driver document with mandatory rejection reason and atomic audit log.
   */
  public async rejectDriverDocument(
    docIdInput: bigint | string,
    reason: string,
    adminUserIdInput: bigint | string,
    clientInfo: AdminClientInfo = {}
  ) {
    const docId = BigInt(docIdInput);
    const adminUserId = BigInt(adminUserIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Document rejection reason is mandatory.');
    }

    const doc = await this.documentRepo.findById(docId);
    if (!doc) {
      throw new NotFoundError(`Driver document with ID ${docId.toString()} not found.`);
    }

    const driver = await this.profileRepo.findById(doc.driverId);
    if (!driver) {
      throw new NotFoundError('Associated driver profile not found.');
    }

    // Self-approval guard
    if (driver.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot reject documents for their own driver profile.');
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDoc = await tx.driverDocument.update({
        where: { id: docId },
        data: {
          verificationStatus: 'REJECTED',
          rejectionReason: reason.trim(),
          reviewedBy: adminUserId,
          reviewedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'DRIVER_DOCUMENT_REJECTED',
          entityName: 'driver_documents',
          entityId: docId,
          newValues: {
            verificationStatus: 'REJECTED',
            rejectionReason: reason.trim(),
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
      });

      return updatedDoc;
    });

    logger.info(`[Driver Admin] Document ${docId.toString()} REJECTED by admin ${adminUserId.toString()}`);

    return {
      id: updated.id.toString(),
      driverId: updated.driverId.toString(),
      documentType: updated.documentType,
      verificationStatus: updated.verificationStatus,
      rejectionReason: updated.rejectionReason,
      reviewedBy: updated.reviewedBy ? updated.reviewedBy.toString() : null,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
    };
  }

  /**
   * Approve a driver profile.
   *
   * Fail-Closed Security Guarantees:
   * 1. Profile completeness check (must be SUBMITTED).
   * 2. Self-approval prevention.
   * 3. Cannot approve already-approved driver.
   * 4. Immediate pre-approval KYC validation:
   *    - Mandatory documents must be VERIFIED.
   *    - No mandatory documents may be expired (Asia/Kolkata semantics).
   *    - Licence endorsement classes must satisfy policy.
   * 5. Atomically transitions approvalStatus to APPROVED, provisions availability, and writes AuditLog.
   */
  public async approveDriver(
    driverIdInput: bigint | string,
    adminUserIdInput: bigint | string,
    clientInfo: AdminClientInfo = {},
    options?: { jurisdiction?: string; vehicleTypeCode?: string }
  ): Promise<DriverDossierResponse> {
    const driverId = BigInt(driverIdInput);
    const adminUserId = BigInt(adminUserIdInput);

    const driver = await this.profileRepo.findById(driverId);
    if (!driver) {
      throw new NotFoundError(`Driver profile with ID ${driverId.toString()} not found.`);
    }

    // 1. Self-approval guard
    if (driver.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot approve their own driver profile.');
    }

    // 2. Duplicate approval check
    if (driver.approvalStatus === 'APPROVED') {
      throw new BadRequestError('Driver profile is already approved.');
    }

    // 3. Profile submission check
    if (driver.submissionStatus !== 'SUBMITTED') {
      throw new BadRequestError(
        `Cannot approve driver profile in '${driver.submissionStatus}' status. Driver must submit application first.`
      );
    }

    // 4. Fail-Closed KYC Policy Gatekeeper (Fresh Revalidation)
    const kycResult = await this.kycValidator.validateDriverWithRepository(driverId, options);
    if (!kycResult.isValid) {
      throw new BadRequestError(
        `Driver approval gate failed: ${kycResult.reasons.join('; ')}`
      );
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Transition driver approval status
      await tx.driverProfile.update({
        where: { id: driverId },
        data: {
          approvalStatus: 'APPROVED',
          rejectionReason: null,
          suspendedAt: null,
          suspensionReason: null,
          reviewedBy: adminUserId,
          reviewedAt: now,
        },
      });

      // Upsert driver availability state
      await this.availabilityRepo.upsertAvailability(
        driverId,
        {
          isOnline: false,
          isBusy: false,
        },
        tx
      );

      // Audit Log in the exact same transaction
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'DRIVER_APPROVED',
          entityName: 'driver_profiles',
          entityId: driverId,
          newValues: {
            approvalStatus: 'APPROVED',
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
      });
    });

    logger.info(`[Driver Admin] Driver ${driverId.toString()} APPROVED by admin ${adminUserId.toString()}`);

    return this.getDriverDossier(driverId);
  }

  /**
   * Reject a driver onboarding application with mandatory rejection reason.
   */
  public async rejectDriver(
    driverIdInput: bigint | string,
    reason: string,
    adminUserIdInput: bigint | string,
    clientInfo: AdminClientInfo = {}
  ): Promise<DriverDossierResponse> {
    const driverId = BigInt(driverIdInput);
    const adminUserId = BigInt(adminUserIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Rejection reason is mandatory.');
    }

    const driver = await this.profileRepo.findById(driverId);
    if (!driver) {
      throw new NotFoundError(`Driver profile with ID ${driverId.toString()} not found.`);
    }

    // Self-approval guard
    if (driver.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot reject their own driver profile.');
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { id: driverId },
        data: {
          submissionStatus: 'REJECTED',
          approvalStatus: 'REJECTED',
          rejectionReason: reason.trim(),
          reviewedBy: adminUserId,
          reviewedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'DRIVER_REJECTED',
          entityName: 'driver_profiles',
          entityId: driverId,
          newValues: {
            approvalStatus: 'REJECTED',
            rejectionReason: reason.trim(),
            reviewedBy: adminUserId.toString(),
            reviewedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
      });
    });

    logger.info(`[Driver Admin] Driver ${driverId.toString()} REJECTED by admin ${adminUserId.toString()}`);

    return this.getDriverDossier(driverId);
  }

  /**
   * Suspend an approved driver profile with mandatory suspension reason.
   */
  public async suspendDriver(
    driverIdInput: bigint | string,
    reason: string,
    adminUserIdInput: bigint | string,
    clientInfo: AdminClientInfo = {}
  ): Promise<DriverDossierResponse> {
    const driverId = BigInt(driverIdInput);
    const adminUserId = BigInt(adminUserIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Suspension reason is mandatory.');
    }

    const driver = await this.profileRepo.findById(driverId);
    if (!driver) {
      throw new NotFoundError(`Driver profile with ID ${driverId.toString()} not found.`);
    }

    // Self-approval guard
    if (driver.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot suspend their own driver profile.');
    }

    if (driver.approvalStatus !== 'APPROVED') {
      throw new BadRequestError(
        `Only APPROVED drivers can be suspended. Current status is '${driver.approvalStatus}'.`
      );
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { id: driverId },
        data: {
          approvalStatus: 'SUSPENDED',
          suspendedAt: now,
          suspensionReason: reason.trim(),
          reviewedBy: adminUserId,
          reviewedAt: now,
        },
      });

      // Reset availability (driver goes offline)
      await this.availabilityRepo.updateDutyStatus(driverId, false, false, tx);

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'DRIVER_SUSPENDED',
          entityName: 'driver_profiles',
          entityId: driverId,
          newValues: {
            approvalStatus: 'SUSPENDED',
            suspensionReason: reason.trim(),
            suspendedAt: now.toISOString(),
            reviewedBy: adminUserId.toString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
      });
    });

    logger.info(`[Driver Admin] Driver ${driverId.toString()} SUSPENDED by admin ${adminUserId.toString()}`);

    return this.getDriverDossier(driverId);
  }

  /**
   * Reactivate a suspended driver profile.
   * Revalidates KYC to ensure no documents expired while suspended.
   */
  public async reactivateDriver(
    driverIdInput: bigint | string,
    adminUserIdInput: bigint | string,
    clientInfo: AdminClientInfo = {},
    callerRole?: string
  ): Promise<DriverDossierResponse> {
    const driverId = BigInt(driverIdInput);
    const adminUserId = BigInt(adminUserIdInput);

    // Enforce administrative role privilege
    if (callerRole && callerRole !== 'ADMIN' && callerRole !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Only administrators can reactivate suspended drivers.');
    }

    const driver = await this.profileRepo.findById(driverId);
    if (!driver) {
      throw new NotFoundError(`Driver profile with ID ${driverId.toString()} not found.`);
    }

    // Self-approval guard
    if (driver.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot reactivate their own driver profile.');
    }

    if (driver.approvalStatus !== 'SUSPENDED') {
      throw new BadRequestError(
        `Only SUSPENDED drivers can be reactivated. Current status is '${driver.approvalStatus}'.`
      );
    }

    // Revalidate KYC documents before reactivating
    const kycResult = await this.kycValidator.validateDriverWithRepository(driverId);
    if (!kycResult.isValid) {
      throw new BadRequestError(
        `Cannot reactivate driver: Mandatory documents expired or invalid. ${kycResult.reasons.join('; ')}`
      );
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { id: driverId },
        data: {
          approvalStatus: 'APPROVED',
          suspendedAt: null,
          suspensionReason: null,
          reviewedBy: adminUserId,
          reviewedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'DRIVER_REACTIVATED',
          entityName: 'driver_profiles',
          entityId: driverId,
          newValues: {
            approvalStatus: 'APPROVED',
            reactivatedBy: adminUserId.toString(),
            reactivatedAt: now.toISOString(),
          },
          ipAddress: clientInfo.ip || null,
          userAgent: clientInfo.userAgent || null,
        },
      });
    });

    logger.info(`[Driver Admin] Driver ${driverId.toString()} REACTIVATED by admin ${adminUserId.toString()}`);

    return this.getDriverDossier(driverId);
  }
}

export const driverAdminService = new DriverAdminService();
