import { vehicleRepository, VehicleRepository } from '../vehicles.repository';
import {
  storageService,
  IStorageService,
} from '../../../common/services/storage.service';
import {
  vehicleKycValidationService,
  VehicleKycValidationService,
} from './vehicle-kyc.service';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '../../../common/errors';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import { vehicleService } from '../vehicles.service';

export class AdminVehicleService {
  constructor(
    private repo: VehicleRepository = vehicleRepository,
    private storage: IStorageService = storageService,
    private kycValidator: VehicleKycValidationService = vehicleKycValidationService
  ) {}

  /**
   * Pending vehicle verification queue
   */
  public async getPendingVehicles() {
    const vehicles = await this.repo.findPendingVehicles();
    return vehicles.map((v) => {
      const activeRel = v.partnerVehicles.find((pv) => pv.ownershipStatus === 'ACTIVE') || v.partnerVehicles[0];
      return {
        id: v.id.toString(),
        registrationNumber: v.registrationNumber,
        make: v.make,
        model: v.model,
        manufacturingYear: v.manufacturingYear,
        rcNumber: v.rcNumber,
        verificationStatus: v.verificationStatus,
        createdAt: v.createdAt.toISOString(),
        vehicleType: {
          id: v.vehicleType.id.toString(),
          typeCode: v.vehicleType.typeCode,
          typeName: v.vehicleType.typeName,
        },
        partner: activeRel?.partner
          ? {
              id: activeRel.partner.id.toString(),
              legalName: activeRel.partner.legalName,
              profileType: activeRel.partner.profileType,
              approvalStatus: activeRel.partner.approvalStatus,
            }
          : null,
        ownership: {
          ownershipType: activeRel?.ownershipType || 'OWNER',
          ownerName: activeRel?.ownerName || null,
        },
        documentCount: v.documents.length,
      };
    });
  }

  /**
   * Vehicle details and inspection dossier
   */
  public async getVehicleDossier(vehicleIdStr: string) {
    const vehicleId = BigInt(vehicleIdStr);
    const vehicle = await this.repo.findVehicleById(vehicleId);

    if (!vehicle) {
      throw new NotFoundError('Vehicle not found.');
    }

    const activeRel = vehicle.partnerVehicles.find((pv) => pv.ownershipStatus === 'ACTIVE') || vehicle.partnerVehicles[0];
    const partner = activeRel?.partner;

    const operationalEligibility = await vehicleService.evaluateVehicleOperationalEligibility(
      vehicle,
      partner || { approvalStatus: 'PENDING' }
    );

    const documents = vehicle.documents.map((d) => vehicleService.serializeDocument(d));

    const dossier = {
      id: vehicle.id.toString(),
      registrationNumber: vehicle.registrationNumber,
      make: vehicle.make,
      model: vehicle.model,
      manufacturingYear: vehicle.manufacturingYear,
      rcNumber: vehicle.rcNumber,
      verificationStatus: vehicle.verificationStatus,
      rejectionReason: vehicle.rejectionReason,
      isActive: vehicle.isActive,
      operationalStatus: operationalEligibility.isOperational,
      createdAt: vehicle.createdAt.toISOString(),
      updatedAt: vehicle.updatedAt.toISOString(),
      vehicleType: {
        id: vehicle.vehicleType.id.toString(),
        typeCode: vehicle.vehicleType.typeCode,
        typeName: vehicle.vehicleType.typeName,
        displayName: vehicle.vehicleType.typeName,
        capacityKg: Number(vehicle.vehicleType.capacityKg),
        volumeCuft: vehicle.vehicleType.volumeCuft ? Number(vehicle.vehicleType.volumeCuft) : null,
      },
      partner: partner
        ? {
            id: partner.id.toString(),
            userId: partner.userId.toString(),
            legalName: partner.legalName,
            profileType: partner.profileType,
            approvalStatus: partner.approvalStatus,
          }
        : null,
      ownership: {
        ownershipType: activeRel?.ownershipType || 'OWNER',
        ownerName: activeRel?.ownerName || null,
        ownershipStatus: activeRel?.ownershipStatus || 'ACTIVE',
        isPrimary: activeRel?.isPrimary ?? false,
        assignedAt: activeRel?.assignedAt ? activeRel.assignedAt.toISOString() : vehicle.createdAt.toISOString(),
        unassignedAt: activeRel?.unassignedAt ? activeRel.unassignedAt.toISOString() : null,
      },
      operationalEligibility,
      kycEvaluation: {
        ...operationalEligibility,
        isKycComplete: operationalEligibility.isOperational,
      },
      documents,
    };

    return {
      vehicle: dossier,
      ...dossier,
    };
  }

  /**
   * Verify individual vehicle document with atomic audit log
   */
  public async verifyVehicleDocument(
    docIdStr: string,
    adminUserIdStr: string,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ) {
    const docId = BigInt(docIdStr);
    const adminUserId = BigInt(adminUserIdStr);

    const doc = await this.repo.findVehicleDocumentById(docId);
    if (!doc) {
      throw new NotFoundError('Vehicle document not found.');
    }

    // Self-approval guard
    const activeRel = doc.vehicle.partnerVehicles.find((pv) => pv.ownershipStatus === 'ACTIVE');
    if (activeRel && activeRel.partner.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot verify documents for vehicles registered to their own partner account.');
    }

    const auditData = {
      actorUserId: adminUserId,
      action: 'VEHICLE_DOCUMENT_VERIFIED',
      entityName: 'vehicle_documents',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    const updated = await this.repo.updateDocumentStatusWithAudit(
      docId,
      'VERIFIED',
      null,
      adminUserId,
      auditData
    );

    logger.info(`[Admin Vehicle] Document ${docId} VERIFIED by admin ${adminUserId}`);
    return vehicleService.serializeDocument(updated);
  }

  /**
   * Reject individual vehicle document with mandatory reason
   */
  public async rejectVehicleDocument(
    docIdStr: string,
    reason: string,
    adminUserIdStr: string,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ) {
    const docId = BigInt(docIdStr);
    const adminUserId = BigInt(adminUserIdStr);

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError('Rejection reason is mandatory.');
    }

    const doc = await this.repo.findVehicleDocumentById(docId);
    if (!doc) {
      throw new NotFoundError('Vehicle document not found.');
    }

    // Self-approval guard
    const activeRel = doc.vehicle.partnerVehicles.find((pv) => pv.ownershipStatus === 'ACTIVE');
    if (activeRel && activeRel.partner.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot reject documents for vehicles registered to their own partner account.');
    }

    const auditData = {
      actorUserId: adminUserId,
      action: 'VEHICLE_DOCUMENT_REJECTED',
      entityName: 'vehicle_documents',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    const updated = await this.repo.updateDocumentStatusWithAudit(
      docId,
      'REJECTED',
      reason.trim(),
      adminUserId,
      auditData
    );

    logger.info(`[Admin Vehicle] Document ${docId} REJECTED by admin ${adminUserId}`);
    return vehicleService.serializeDocument(updated);
  }

  /**
   * Securely stream vehicle document binary for admin review
   */
  public async getDocumentFileForAdmin(
    docIdStr: string
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const docId = BigInt(docIdStr);
    const doc = await this.repo.findVehicleDocumentById(docId);
    if (!doc) {
      throw new NotFoundError('Vehicle document not found.');
    }
    return this.storage.getFile(doc.documentStorageKey);
  }

  /**
   * Approve vehicle (fails closed if KYC documents are invalid or expired)
   */
  public async approveVehicle(
    vehicleIdStr: string,
    adminUserIdStr: string,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ) {
    const vehicleId = BigInt(vehicleIdStr);
    const adminUserId = BigInt(adminUserIdStr);

    const vehicle = await this.repo.findVehicleById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found.');
    }

    if (vehicle.verificationStatus === 'VERIFIED') {
      throw new BadRequestError('Vehicle is already approved and verified.');
    }

    // Self-approval guard
    const activeRel = vehicle.partnerVehicles.find((pv) => pv.ownershipStatus === 'ACTIVE');
    if (activeRel && activeRel.partner.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot approve vehicles registered to their own partner account.');
    }

    // Fail-Closed KYC Policy Validation Gate
    const latestDocs = await this.repo.findLatestDocumentsByVehicle(vehicleId);
    const ownershipType = activeRel?.ownershipType || 'OWNER';

    const kycResult = await this.kycValidator.validateForApproval(
      {
        typeCode: vehicle.vehicleType.typeCode,
        ownershipType,
      },
      latestDocs
    );

    if (!kycResult.isValid) {
      throw new BadRequestError(
        `Vehicle approval gate failed: ${kycResult.reasons.join('; ')}`
      );
    }

    const auditData = {
      actorUserId: adminUserId,
      action: 'VEHICLE_APPROVED',
      entityName: 'vehicles',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    const updated = await this.repo.approveVehicleWithAudit(vehicleId, adminUserId, auditData);
    logger.info(`[Admin Vehicle] Vehicle ${vehicleId} APPROVED by admin ${adminUserId}`);

    return this.getVehicleDossier(vehicleIdStr);
  }

  /**
   * Reject vehicle with mandatory rejection reason
   */
  public async rejectVehicle(
    vehicleIdStr: string,
    reason: string,
    adminUserIdStr: string,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ) {
    const vehicleId = BigInt(vehicleIdStr);
    const adminUserId = BigInt(adminUserIdStr);

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError('Rejection reason is mandatory.');
    }

    const vehicle = await this.repo.findVehicleById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found.');
    }

    // Self-approval guard
    const activeRel = vehicle.partnerVehicles.find((pv) => pv.ownershipStatus === 'ACTIVE');
    if (activeRel && activeRel.partner.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot reject vehicles registered to their own partner account.');
    }

    const auditData = {
      actorUserId: adminUserId,
      action: 'VEHICLE_REJECTED',
      entityName: 'vehicles',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    await this.repo.rejectVehicleWithAudit(vehicleId, reason.trim(), adminUserId, auditData);
    logger.info(`[Admin Vehicle] Vehicle ${vehicleId} REJECTED by admin ${adminUserId}`);

    return this.getVehicleDossier(vehicleIdStr);
  }

  /**
   * Suspend verified vehicle with mandatory suspension reason
   */
  public async suspendVehicle(
    vehicleIdStr: string,
    reason: string,
    adminUserIdStr: string,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ) {
    const vehicleId = BigInt(vehicleIdStr);
    const adminUserId = BigInt(adminUserIdStr);

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError('Suspension reason is mandatory.');
    }

    const vehicle = await this.repo.findVehicleById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found.');
    }

    if (vehicle.verificationStatus !== 'VERIFIED') {
      throw new BadRequestError(
        `Only VERIFIED vehicles can be suspended. Current status is ${vehicle.verificationStatus}.`
      );
    }

    // Self-approval guard
    const activeRel = vehicle.partnerVehicles.find((pv) => pv.ownershipStatus === 'ACTIVE');
    if (activeRel && activeRel.partner.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot suspend vehicles registered to their own partner account.');
    }

    const auditData = {
      actorUserId: adminUserId,
      action: 'VEHICLE_SUSPENDED',
      entityName: 'vehicles',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    await this.repo.suspendVehicleWithAudit(vehicleId, reason.trim(), adminUserId, auditData);
    logger.info(`[Admin Vehicle] Vehicle ${vehicleId} SUSPENDED by admin ${adminUserId}`);

    return this.getVehicleDossier(vehicleIdStr);
  }

  /**
   * Reactivate suspended vehicle
   */
  public async reactivateVehicle(
    vehicleIdStr: string,
    adminUserIdStr: string,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ) {
    const vehicleId = BigInt(vehicleIdStr);
    const adminUserId = BigInt(adminUserIdStr);

    const vehicle = await this.repo.findVehicleById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found.');
    }

    if (vehicle.verificationStatus !== 'SUSPENDED') {
      throw new BadRequestError(
        `Only SUSPENDED vehicles can be reactivated. Current status is ${vehicle.verificationStatus}.`
      );
    }

    // Self-approval guard
    const activeRel = vehicle.partnerVehicles.find((pv) => pv.ownershipStatus === 'ACTIVE');
    if (activeRel && activeRel.partner.userId === adminUserId) {
      throw new ForbiddenError('Admins cannot reactivate vehicles registered to their own partner account.');
    }

    const auditData = {
      actorUserId: adminUserId,
      action: 'VEHICLE_REACTIVATED',
      entityName: 'vehicles',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    await this.repo.reactivateVehicleWithAudit(vehicleId, adminUserId, auditData);
    logger.info(`[Admin Vehicle] Vehicle ${vehicleId} REACTIVATED by admin ${adminUserId}`);

    return this.getVehicleDossier(vehicleIdStr);
  }

  /**
   * Transfer vehicle ownership from old partner to new partner (Super Admin Only)
   */
  public async transferVehicleOwnership(
    vehicleIdStr: string,
    input: {
      targetPartnerId: string;
      transferReason: string;
      newOwnershipType?: string;
      newOwnerName?: string;
    },
    superAdminUserIdStr: string,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ) {
    const vehicleId = BigInt(vehicleIdStr);
    const targetPartnerId = BigInt(input.targetPartnerId);
    const superAdminUserId = BigInt(superAdminUserIdStr);

    const vehicle = await this.repo.findVehicleById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found.');
    }

    const activePartnerRel = vehicle.partnerVehicles.find(
      (pv) => pv.ownershipStatus === 'ACTIVE'
    );

    if (!activePartnerRel) {
      throw new BadRequestError('Vehicle has no active partner ownership record to transfer.');
    }

    if (activePartnerRel.partnerId === targetPartnerId) {
      throw new BadRequestError('Vehicle is already registered to this target partner.');
    }

    const targetPartner = await prisma.partnerProfile.findUnique({
      where: { id: targetPartnerId },
    });

    if (!targetPartner) {
      throw new NotFoundError(`Target partner profile ${input.targetPartnerId} not found.`);
    }

    const auditData = {
      actorUserId: superAdminUserId,
      action: 'VEHICLE_TRANSFERRED',
      entityName: 'vehicles',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    const result = await this.repo.transferVehicleOwnershipWithAudit(
      vehicleId,
      activePartnerRel.partnerId,
      targetPartnerId,
      {
        transferReason: input.transferReason,
        newOwnershipType: input.newOwnershipType || 'OWNER',
        newOwnerName: input.newOwnerName,
      },
      auditData
    );

    logger.info(
      `[Admin Vehicle Transfer] Vehicle ${vehicleId} transferred from partner ${activePartnerRel.partnerId} to ${targetPartnerId}`
    );

    return {
      message: `Vehicle ownership transferred successfully to partner ${targetPartnerId}. Vehicle verification status reset to PENDING.`,
      vehicleId: vehicleId.toString(),
      formerPartnerId: activePartnerRel.partnerId.toString(),
      newPartnerId: targetPartnerId.toString(),
      newRelationshipId: result.newRelationship.id.toString(),
    };
  }
}

export const adminVehicleService = new AdminVehicleService();

