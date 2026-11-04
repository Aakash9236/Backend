import { adminRepository, AdminRepository } from './admin.repository';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../common/errors';
import { logger } from '../../config/logger.config';
import {
  kycValidationService,
  KycValidationService,
} from './services/kyc-validation.service';
import { storageService, IStorageService } from '../../common/services/storage.service';
import { UserRole } from '../../common/constants';

export class AdminService {
  constructor(
    private repo: AdminRepository = adminRepository,
    private kycValidator: KycValidationService = kycValidationService,
    private storage: IStorageService = storageService
  ) {}

  public async getPendingPartners() {
    const partners = await this.repo.findPendingPartners();
    return partners.map((p) => this.serializePartnerSummary(p));
  }

  public async getPartnerById(partnerIdStr: string) {
    let partnerId: bigint;
    try {
      partnerId = BigInt(partnerIdStr);
    } catch {
      throw new BadRequestError('Invalid partner ID format.');
    }

    const partner = await this.repo.findPartnerDetailById(partnerId);

    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    return this.serializePartnerDetail(partner);
  }

  public async approvePartner(
    adminUserIdStr: string,
    partnerIdStr: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let partnerId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      partnerId = BigInt(partnerIdStr);
    } catch {
      throw new BadRequestError('Invalid ID format.');
    }

    const partner = await this.repo.findPartnerDetailById(partnerId);
    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    // Business Rule: Self-approval prevention
    if (partner.userId === adminUserId) {
      throw new ForbiddenError(
        'Platform security policy: Administrators cannot review or approve their own partner profile.'
      );
    }

    if (partner.approvalStatus === 'APPROVED') {
      throw new BadRequestError('Partner is already in APPROVED status.');
    }

    // Issue A: Enforce configurable KYC requirement gate (fail-closed if policy unavailable/invalid)
    const kycResult = await this.kycValidator.validateForApproval(
      partner,
      partner.documents || []
    );

    if (!kycResult.isValid) {
      logger.warn(
        `[Admin Approval Gate Blocked] Partner ID ${partnerIdStr} cannot be approved: ${kycResult.reasons.join(
          '; '
        )}`
      );
      throw new BadRequestError(
        `Partner approval blocked by KYC policy: ${kycResult.reasons.join('; ')}`
      );
    }

    const previousStatus = partner.approvalStatus;

    // Issue D: Atomic status update & audit log insertion via prisma.$transaction
    const updated = await this.repo.updatePartnerStatusWithAudit(
      partnerId,
      {
        status: 'APPROVED',
        reason: null,
        adminUserId,
      },
      {
        actorUserId: adminUserId,
        action: 'PARTNER_APPROVED',
        entityName: 'partner_profiles',
        entityId: partnerId,
        oldValues: { approvalStatus: previousStatus },
        newValues: { approvalStatus: 'APPROVED', reviewedBy: adminUserIdStr },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }
    );

    logger.info(
      `[Admin Audit] Partner ID ${partnerIdStr} approved by Admin ID ${adminUserIdStr}`
    );

    return this.serializePartnerSummary(updated);
  }

  public async rejectPartner(
    adminUserIdStr: string,
    partnerIdStr: string,
    reason: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let partnerId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      partnerId = BigInt(partnerIdStr);
    } catch {
      throw new BadRequestError('Invalid ID format.');
    }

    const partner = await this.repo.findPartnerDetailById(partnerId);
    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    // Business Rule: Self-review prevention
    if (partner.userId === adminUserId) {
      throw new ForbiddenError(
        'Platform security policy: Administrators cannot review their own partner profile.'
      );
    }

    if (partner.approvalStatus === 'REJECTED') {
      throw new BadRequestError('Partner is already in REJECTED status.');
    }

    const previousStatus = partner.approvalStatus;

    // Issue D: Atomic status update & audit log insertion via prisma.$transaction
    const updated = await this.repo.updatePartnerStatusWithAudit(
      partnerId,
      {
        status: 'REJECTED',
        reason,
        adminUserId,
      },
      {
        actorUserId: adminUserId,
        action: 'PARTNER_REJECTED',
        entityName: 'partner_profiles',
        entityId: partnerId,
        oldValues: { approvalStatus: previousStatus },
        newValues: {
          approvalStatus: 'REJECTED',
          rejectionReason: reason,
          reviewedBy: adminUserIdStr,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }
    );

    logger.info(
      `[Admin Audit] Partner ID ${partnerIdStr} rejected by Admin ID ${adminUserIdStr}. Reason: ${reason}`
    );

    return this.serializePartnerSummary(updated);
  }

  public async suspendPartner(
    adminUserIdStr: string,
    partnerIdStr: string,
    reason: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let partnerId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      partnerId = BigInt(partnerIdStr);
    } catch {
      throw new BadRequestError('Invalid ID format.');
    }

    const partner = await this.repo.findPartnerDetailById(partnerId);
    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    // Business Rule: Self-review prevention
    if (partner.userId === adminUserId) {
      throw new ForbiddenError(
        'Platform security policy: Administrators cannot review their own partner profile.'
      );
    }

    // Issue C: Strict state machine transition validation
    // Suspension is strictly permitted ONLY if current approvalStatus is APPROVED
    if (partner.approvalStatus !== 'APPROVED') {
      throw new BadRequestError(
        `Invalid state transition: Cannot suspend partner in '${partner.approvalStatus}' status. Only currently APPROVED partners can be suspended.`
      );
    }

    const previousStatus = partner.approvalStatus;

    // Issue D: Atomic status update & audit log insertion via prisma.$transaction
    const updated = await this.repo.updatePartnerStatusWithAudit(
      partnerId,
      {
        status: 'SUSPENDED',
        reason,
        adminUserId,
      },
      {
        actorUserId: adminUserId,
        action: 'PARTNER_SUSPENDED',
        entityName: 'partner_profiles',
        entityId: partnerId,
        oldValues: { approvalStatus: previousStatus },
        newValues: {
          approvalStatus: 'SUSPENDED',
          rejectionReason: reason,
          reviewedBy: adminUserIdStr,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }
    );

    logger.info(
      `[Admin Audit] Partner ID ${partnerIdStr} suspended by Admin ID ${adminUserIdStr}. Reason: ${reason}`
    );

    return this.serializePartnerSummary(updated);
  }

  public async verifyDocument(
    adminUserIdStr: string,
    documentIdStr: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let documentId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      documentId = BigInt(documentIdStr);
    } catch {
      throw new BadRequestError('Invalid ID format.');
    }

    const doc = await this.repo.findDocumentById(documentId);
    if (!doc) {
      throw new NotFoundError('Partner document not found.');
    }

    const previousStatus = doc.verificationStatus;

    // Issue D: Atomic update
    const updated = await this.repo.updateDocumentStatusWithAudit(
      documentId,
      {
        status: 'VERIFIED',
        reason: null,
        adminUserId,
      },
      {
        actorUserId: adminUserId,
        action: 'PARTNER_DOCUMENT_VERIFIED',
        entityName: 'partner_documents',
        entityId: documentId,
        oldValues: { verificationStatus: previousStatus },
        newValues: { verificationStatus: 'VERIFIED', reviewedBy: adminUserIdStr },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }
    );

    return {
      id: updated.id.toString(),
      partnerId: updated.partnerId.toString(),
      documentType: updated.documentType,
      verificationStatus: updated.verificationStatus,
      reviewedBy: updated.reviewedBy ? updated.reviewedBy.toString() : null,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
    };
  }

  public async rejectDocument(
    adminUserIdStr: string,
    documentIdStr: string,
    reason: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let documentId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      documentId = BigInt(documentIdStr);
    } catch {
      throw new BadRequestError('Invalid ID format.');
    }

    const doc = await this.repo.findDocumentById(documentId);
    if (!doc) {
      throw new NotFoundError('Partner document not found.');
    }

    const previousStatus = doc.verificationStatus;

    // Issue D: Atomic update
    const updated = await this.repo.updateDocumentStatusWithAudit(
      documentId,
      {
        status: 'REJECTED',
        reason,
        adminUserId,
      },
      {
        actorUserId: adminUserId,
        action: 'PARTNER_DOCUMENT_REJECTED',
        entityName: 'partner_documents',
        entityId: documentId,
        oldValues: { verificationStatus: previousStatus },
        newValues: {
          verificationStatus: 'REJECTED',
          rejectionReason: reason,
          reviewedBy: adminUserIdStr,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }
    );

    return {
      id: updated.id.toString(),
      partnerId: updated.partnerId.toString(),
      documentType: updated.documentType,
      verificationStatus: updated.verificationStatus,
      rejectionReason: updated.rejectionReason,
      reviewedBy: updated.reviewedBy ? updated.reviewedBy.toString() : null,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
    };
  }

  public async verifySkill(
    adminUserIdStr: string,
    skillIdStr: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let skillId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      skillId = BigInt(skillIdStr);
    } catch {
      throw new BadRequestError('Invalid ID format.');
    }

    const skill = await this.repo.findSkillById(skillId);
    if (!skill) {
      throw new NotFoundError('Partner skill not found.');
    }

    const previousStatus = skill.verificationStatus;

    // Issue D: Atomic update
    const updated = await this.repo.updateSkillStatusWithAudit(
      skillId,
      'VERIFIED',
      {
        actorUserId: adminUserId,
        action: 'PARTNER_SKILL_VERIFIED',
        entityName: 'partner_skills',
        entityId: skillId,
        oldValues: { verificationStatus: previousStatus },
        newValues: { verificationStatus: 'VERIFIED' },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }
    );

    return {
      id: updated.id.toString(),
      partnerId: updated.partnerId.toString(),
      serviceCategoryId: updated.serviceCategoryId.toString(),
      verificationStatus: updated.verificationStatus,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  public async rejectSkill(
    adminUserIdStr: string,
    skillIdStr: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let skillId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      skillId = BigInt(skillIdStr);
    } catch {
      throw new BadRequestError('Invalid ID format.');
    }

    const skill = await this.repo.findSkillById(skillId);
    if (!skill) {
      throw new NotFoundError('Partner skill not found.');
    }

    const previousStatus = skill.verificationStatus;

    // Issue D: Atomic update
    const updated = await this.repo.updateSkillStatusWithAudit(
      skillId,
      'REJECTED',
      {
        actorUserId: adminUserId,
        action: 'PARTNER_SKILL_REJECTED',
        entityName: 'partner_skills',
        entityId: skillId,
        oldValues: { verificationStatus: previousStatus },
        newValues: { verificationStatus: 'REJECTED' },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }
    );

    return {
      id: updated.id.toString(),
      partnerId: updated.partnerId.toString(),
      serviceCategoryId: updated.serviceCategoryId.toString(),
      verificationStatus: updated.verificationStatus,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Issue E: Secure Admin KYC Document Streaming
   * Resolves physical storage file safely without leaking filesystem paths.
   * Validates document ID and content type safely.
   */
  public async getDocumentFile(_adminUserIdStr: string, documentIdStr: string) {
    let documentId: bigint;
    try {
      if (!/^\d+$/.test(documentIdStr)) {
        throw new BadRequestError('Invalid document ID format.');
      }
      documentId = BigInt(documentIdStr);
      if (documentId <= 0n) {
        throw new BadRequestError('Document ID must be a positive integer.');
      }
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      throw new BadRequestError('Invalid document ID.');
    }

    const doc = await this.repo.findDocumentById(documentId);
    if (!doc) {
      throw new NotFoundError('Partner document not found.');
    }

    if (!doc.documentStorageKey) {
      throw new NotFoundError('Document file reference is missing.');
    }

    let fileResult: { buffer: Buffer; mimeType: string };
    try {
      fileResult = await this.storage.getFile(doc.documentStorageKey);
    } catch (err: any) {
      // Never leak local filesystem paths in error responses
      logger.error(`[Admin Document Viewing Error] Failed to retrieve document ${documentIdStr}:`, err);
      throw new NotFoundError('Document file not found on storage server.');
    }

    // Detect safe MIME type from buffer magic bytes (do not blindly trust client MIME or extension)
    const detectedMime = this.detectSafeMimeType(fileResult.buffer, fileResult.mimeType);
    const ext = this.getExtensionForMime(detectedMime);
    const safeFilename = `partner_doc_${doc.id.toString()}_${doc.documentType.toLowerCase()}${ext}`;

    return {
      buffer: fileResult.buffer,
      mimeType: detectedMime,
      filename: safeFilename,
      sizeBytes: fileResult.buffer.length,
    };
  }

  private detectSafeMimeType(buffer: Buffer, declaredMime: string): string {
    // Magic byte sniffing
    if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return 'application/pdf';
    }
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return 'image/webp';
    }

    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (allowed.includes(declaredMime.toLowerCase())) {
      return declaredMime.toLowerCase();
    }
    return 'application/octet-stream';
  }

  private getExtensionForMime(mime: string): string {
    switch (mime) {
      case 'application/pdf': return '.pdf';
      case 'image/png': return '.png';
      case 'image/jpeg': return '.jpg';
      case 'image/webp': return '.webp';
      default: return '.bin';
    }
  }

  /**
   * Phase 6B: Assign role to user (Super Admin only)
   * Enforces self-escalation prevention, idempotency, and atomic audit logging.
   */
  public async assignUserRole(
    adminUserIdStr: string,
    targetUserIdStr: string,
    roleNameRaw: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let targetUserId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      targetUserId = BigInt(targetUserIdStr);
    } catch {
      throw new BadRequestError('Invalid user ID format.');
    }

    const roleName = (roleNameRaw || '').trim().toUpperCase();
    const validRoles = Object.values(UserRole) as string[];
    if (!validRoles.includes(roleName)) {
      throw new BadRequestError(
        `Invalid role name: '${roleNameRaw}'. Allowed roles are: ${validRoles.join(', ')}.`
      );
    }

    // Security Rule: Prevent self-escalation
    if (adminUserId === targetUserId) {
      throw new ForbiddenError(
        'Self-escalation policy violation: Administrators cannot assign roles to their own account.'
      );
    }

    const user = await this.repo.findUserWithRoles(targetUserId);
    if (!user) {
      throw new NotFoundError('Target user not found.');
    }

    const role = await this.repo.findRoleByName(roleName);
    if (!role) {
      throw new NotFoundError(`Role '${roleName}' is not configured in the database.`);
    }

    const alreadyAssigned = user.userRoles.some((ur) => ur.roleId === role.id);
    if (alreadyAssigned) {
      // Idempotent: Role is already assigned
      return {
        userId: user.id.toString(),
        roles: user.userRoles.map((ur) => ur.role.roleName),
        message: `Role '${roleName}' is already assigned to this user.`,
      };
    }

    // Atomically assign role with audit log
    const updatedUser = await this.repo.assignRoleWithAudit(targetUserId, role.id, {
      actorUserId: adminUserId,
      action: 'ROLE_ASSIGNED',
      entityName: 'user_roles',
      entityId: targetUserId,
      newValues: { roleName, targetUserId: targetUserId.toString() },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    logger.info(
      `[Privileged Role Admin] Super Admin ${adminUserIdStr} assigned role ${roleName} to User ${targetUserIdStr}`
    );

    return {
      userId: updatedUser!.id.toString(),
      roles: updatedUser!.userRoles.map((ur) => ur.role.roleName),
      message: `Role '${roleName}' assigned successfully.`,
    };
  }

  /**
   * Phase 6B: Revoke role from user (Super Admin only)
   * Enforces self-revocation prevention, last-super-admin protection, minimum 1 role, and atomic audit logging.
   */
  public async revokeUserRole(
    adminUserIdStr: string,
    targetUserIdStr: string,
    roleNameRaw: string,
    context: { ipAddress?: string; userAgent?: string } = {}
  ) {
    let adminUserId: bigint;
    let targetUserId: bigint;
    try {
      adminUserId = BigInt(adminUserIdStr);
      targetUserId = BigInt(targetUserIdStr);
    } catch {
      throw new BadRequestError('Invalid user ID format.');
    }

    const roleName = (roleNameRaw || '').trim().toUpperCase();
    const validRoles = Object.values(UserRole) as string[];
    if (!validRoles.includes(roleName)) {
      throw new BadRequestError(
        `Invalid role name: '${roleNameRaw}'. Allowed roles are: ${validRoles.join(', ')}.`
      );
    }

    // Security Rule: Prevent self-revocation
    if (adminUserId === targetUserId) {
      throw new ForbiddenError(
        'Platform security policy: Administrators cannot revoke roles from their own account.'
      );
    }

    const user = await this.repo.findUserWithRoles(targetUserId);
    if (!user) {
      throw new NotFoundError('Target user not found.');
    }

    const role = await this.repo.findRoleByName(roleName);
    if (!role) {
      throw new NotFoundError(`Role '${roleName}' not found.`);
    }

    const holdsRole = user.userRoles.some((ur) => ur.roleId === role.id);
    if (!holdsRole) {
      throw new BadRequestError(`User does not hold the '${roleName}' role.`);
    }

    // Business Rule: A user account must always hold at least 1 role
    if (user.userRoles.length <= 1) {
      throw new BadRequestError(
        'Cannot revoke the only remaining role from a user account. Accounts must hold at least one role.'
      );
    }

    // Safety Rule: Prevent removal of the last remaining SUPER_ADMIN
    if (roleName === UserRole.SUPER_ADMIN) {
      const superAdminCount = await this.repo.countUsersWithRole(role.id);
      if (superAdminCount <= 1) {
        throw new BadRequestError(
          'Platform safety policy: Cannot revoke the last remaining SUPER_ADMIN from the platform.'
        );
      }
    }

    // Atomically revoke role with audit log
    const updatedUser = await this.repo.revokeRoleWithAudit(targetUserId, role.id, {
      actorUserId: adminUserId,
      action: 'ROLE_REVOKED',
      entityName: 'user_roles',
      entityId: targetUserId,
      oldValues: { roleName, targetUserId: targetUserId.toString() },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    logger.info(
      `[Privileged Role Admin] Super Admin ${adminUserIdStr} revoked role ${roleName} from User ${targetUserIdStr}`
    );

    return {
      userId: updatedUser!.id.toString(),
      roles: updatedUser!.userRoles.map((ur) => ur.role.roleName),
      message: `Role '${roleName}' revoked successfully.`,
    };
  }

  private serializePartnerSummary(p: any) {
    return {
      id: p.id.toString(),
      userId: p.userId.toString(),
      profileType: p.profileType,
      legalName: p.legalName,
      businessName: p.businessName,
      experienceYears: p.experienceYears,
      approvalStatus: p.approvalStatus,
      rejectionReason: p.rejectionReason,
      reviewedBy: p.reviewedBy ? p.reviewedBy.toString() : null,
      reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
      user: p.user
        ? {
            id: p.user.id.toString(),
            mobileNumber: p.user.mobileNumber,
            email: p.user.email,
          }
        : undefined,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private serializePartnerDetail(p: any) {
    return {
      id: p.id.toString(),
      userId: p.userId.toString(),
      profileType: p.profileType,
      legalName: p.legalName,
      businessName: p.businessName,
      businessDescription: p.businessDescription,
      experienceYears: p.experienceYears,
      approvalStatus: p.approvalStatus,
      rejectionReason: p.rejectionReason,
      reviewedBy: p.reviewedBy ? p.reviewedBy.toString() : null,
      reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
      user: p.user
        ? {
            id: p.user.id.toString(),
            mobileNumber: p.user.mobileNumber,
            email: p.user.email,
            accountStatus: p.user.accountStatus,
            isMobileVerified: p.user.isMobileVerified,
            createdAt: p.user.createdAt.toISOString(),
          }
        : null,
      documents: p.documents
        ? p.documents.map((d: any) => ({
            id: d.id.toString(),
            documentType: d.documentType,
            documentStorageKey: d.documentStorageKey,
            verificationStatus: d.verificationStatus,
            rejectionReason: d.rejectionReason,
            reviewedBy: d.reviewedBy ? d.reviewedBy.toString() : null,
            reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
            uploadedAt: d.uploadedAt.toISOString(),
          }))
        : [],
      skills: p.skills
        ? p.skills.map((s: any) => ({
            id: s.id.toString(),
            serviceCategoryId: s.serviceCategoryId.toString(),
            categoryName: s.category ? s.category.categoryName : undefined,
            categoryCode: s.category ? s.category.categoryCode : undefined,
            experienceYears: s.experienceYears,
            verificationStatus: s.verificationStatus,
            isActive: s.isActive,
          }))
        : [],
      serviceAreas: p.serviceAreas
        ? p.serviceAreas.map((sa: any) => ({
            id: sa.id.toString(),
            cityId: sa.cityId.toString(),
            cityName: sa.city ? sa.city.cityName : undefined,
            areaId: sa.areaId ? sa.areaId.toString() : null,
            areaName: sa.area ? sa.area.areaName : null,
            coverageType: sa.coverageType,
            serviceRadiusKm: sa.serviceRadiusKm ? Number(sa.serviceRadiusKm) : null,
          }))
        : [],
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}

export const adminService = new AdminService();
