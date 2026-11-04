import { vehicleRepository, VehicleRepository } from './vehicles.repository';
import {
  storageService,
  IStorageService,
} from '../../common/services/storage.service';
import {
  vehicleKycValidationService,
  VehicleKycValidationService,
} from './services/vehicle-kyc.service';
import { DateUtil } from '../../common/utils/date.util';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../common/errors';
import { prisma } from '../../config/db.config';
import {
  RegisterVehicleInput,
  UpdateVehicleInput,
  UploadVehicleDocumentInput,
  VehicleResponse,
  VehicleDocumentResponse,
  VehicleTypeResponse,
  VehicleOperationalEligibility,
} from './vehicles.types';
import { logger } from '../../config/logger.config';

export class VehicleService {
  constructor(
    private repo: VehicleRepository = vehicleRepository,
    private storage: IStorageService = storageService,
    private kycValidator: VehicleKycValidationService = vehicleKycValidationService
  ) {}

  /**
   * List available vehicle types
   */
  public async getVehicleTypes(serviceCategoryIdStr?: string): Promise<VehicleTypeResponse[]> {
    let serviceCategoryId: bigint | undefined;
    if (serviceCategoryIdStr) {
      try {
        serviceCategoryId = BigInt(serviceCategoryIdStr);
      } catch {
        throw new BadRequestError('Invalid service category ID format.');
      }
    }

    const types = await this.repo.findVehicleTypes(serviceCategoryId);
    return types.map((t) => ({
      id: t.id.toString(),
      typeCode: t.typeCode,
      typeName: t.typeName,
      displayName: t.typeName,
      serviceCategoryId: t.serviceCategoryId.toString(),
      capacityKg: Number(t.capacityKg),
      volumeCuft: t.volumeCuft ? Number(t.volumeCuft) : null,
      baseFare: Number(t.baseFare),
      perKmRate: Number(t.perKmRate),
      perMinuteRate: Number(t.perMinuteRate),
      isActive: t.isActive,
    }));
  }

  /**
   * Register a new vehicle into the partner's fleet
   */
  public async registerVehicle(
    userIdStr: string,
    input: RegisterVehicleInput,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ): Promise<VehicleResponse> {
    const userId = BigInt(userIdStr);
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile must be created before registering vehicles.');
    }

    const vehicleTypeId = BigInt(input.vehicleTypeId);
    const vehicleType = await this.repo.findVehicleTypeById(vehicleTypeId);
    if (!vehicleType) {
      throw new NotFoundError(`Vehicle type with ID ${input.vehicleTypeId} does not exist.`);
    }

    const normalizedReg = DateUtil.normalizeRegistrationNumber(input.registrationNumber);
    if (!normalizedReg || normalizedReg.length < 3) {
      throw new BadRequestError('Invalid vehicle registration number format.');
    }

    // Check if vehicle is already registered
    const existingVehicle = await this.repo.findVehicleByRegistration(normalizedReg);
    if (existingVehicle) {
      const activePartnerRel = existingVehicle.partnerVehicles.find(
        (pv) => pv.ownershipStatus === 'ACTIVE'
      );
      if (activePartnerRel) {
        if (activePartnerRel.partnerId === partner.id) {
          throw new ConflictError(
            `Vehicle '${normalizedReg}' is already registered in your fleet.`
          );
        } else {
          throw new ConflictError(
            `Vehicle '${normalizedReg}' is already actively registered by another partner.`
          );
        }
      }
    }

    const auditData = {
      actorUserId: userId,
      action: 'VEHICLE_REGISTERED',
      entityName: 'vehicles',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    let resultVehicle;

    if (existingVehicle) {
      // Re-registering previously unassigned/transferred vehicle to new partner
      const createdRel = await prisma.partnerVehicle.create({
        data: {
          partnerId: partner.id,
          vehicleId: existingVehicle.id,
          ownershipType: input.ownershipType,
          ownerName: input.ownerName || null,
          ownershipStatus: 'ACTIVE',
          isPrimary: false,
        },
      });

      resultVehicle = {
        ...existingVehicle,
        partnerVehicle: createdRel,
      };
    } else {
      // Brand new vehicle registration
      resultVehicle = await this.repo.createVehicleWithOwnership(
        partner.id,
        {
          vehicleTypeId,
          registrationNumber: normalizedReg,
          make: input.make,
          model: input.model,
          manufacturingYear: input.manufacturingYear,
          rcNumber: input.rcNumber,
        },
        {
          ownershipType: input.ownershipType,
          ownerName: input.ownerName,
        },
        auditData
      );
    }

    logger.info(`[Vehicle Register] Vehicle ${normalizedReg} registered for partner ${partner.id}`);

    const complete = await this.repo.findVehicleById(resultVehicle.id);
    return this.serializeVehicle(complete!, partner);
  }

  /**
   * List all vehicles in authenticated partner's fleet
   */
  public async getPartnerVehicles(userIdStr: string): Promise<VehicleResponse[]> {
    const userId = BigInt(userIdStr);
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      return [];
    }

    const partnerVehicles = await this.repo.findPartnerVehicles(partner.id);

    const serializedList: VehicleResponse[] = [];
    for (const pv of partnerVehicles) {
      const serialized = await this.serializeVehicle(
        {
          ...pv.vehicle,
          partnerVehicles: [pv],
        },
        partner
      );
      serializedList.push(serialized);
    }

    return serializedList;
  }

  /**
   * Get single vehicle details in partner's fleet
   */
  public async getPartnerVehicleById(
    userIdStr: string,
    vehicleIdStr: string
  ): Promise<VehicleResponse> {
    const userId = BigInt(userIdStr);
    const vehicleId = BigInt(vehicleIdStr);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const partnerVehicle = await this.repo.findPartnerVehicleById(partner.id, vehicleId);
    if (!partnerVehicle) {
      throw new NotFoundError('Vehicle not found in your fleet.');
    }

    const vehicle = await this.repo.findVehicleById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle record not found.');
    }

    return this.serializeVehicle(
      {
        ...vehicle,
        partnerVehicles: [partnerVehicle],
      },
      partner
    );
  }

  /**
   * Update permitted vehicle non-compliance metadata
   */
  public async updateVehicle(
    userIdStr: string,
    vehicleIdStr: string,
    input: UpdateVehicleInput
  ): Promise<VehicleResponse> {
    const userId = BigInt(userIdStr);
    const vehicleId = BigInt(vehicleIdStr);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const partnerVehicle = await this.repo.findPartnerVehicleById(partner.id, vehicleId);
    if (!partnerVehicle || partnerVehicle.ownershipStatus !== 'ACTIVE') {
      throw new ForbiddenError('You can only update active vehicles in your fleet.');
    }

    await this.repo.updateVehicle(vehicleId, input);

    const updated = await this.repo.findVehicleById(vehicleId);
    return this.serializeVehicle(
      {
        ...updated!,
        partnerVehicles: [partnerVehicle],
      },
      partner
    );
  }

  /**
   * Designate vehicle as primary in fleet
   */
  public async setPrimaryVehicle(
    userIdStr: string,
    vehicleIdStr: string
  ): Promise<{ message: string; vehicle: VehicleResponse }> {
    const userId = BigInt(userIdStr);
    const vehicleId = BigInt(vehicleIdStr);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const partnerVehicle = await this.repo.findPartnerVehicleById(partner.id, vehicleId);
    if (!partnerVehicle || partnerVehicle.ownershipStatus !== 'ACTIVE') {
      throw new NotFoundError('Vehicle not found in your fleet.');
    }

    await this.repo.setPrimaryVehicle(partner.id, vehicleId);
    const updated = await this.repo.findVehicleById(vehicleId);
    const serialized = await this.serializeVehicle(
      {
        ...updated!,
        partnerVehicles: [{ ...partnerVehicle, isPrimary: true }],
      },
      partner
    );
    return {
      message: 'Primary vehicle updated successfully.',
      vehicle: serialized,
    };
  }

  /**
   * Partner toggles active status of their vehicle (e.g. maintenance downtime)
   */
  public async setVehicleActiveStatus(
    userIdStr: string,
    vehicleIdStr: string,
    isActive: boolean,
    clientInfo: { ip?: string; userAgent?: string } = {}
  ): Promise<VehicleResponse> {
    const userId = BigInt(userIdStr);
    const vehicleId = BigInt(vehicleIdStr);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const partnerVehicle = await this.repo.findPartnerVehicleById(partner.id, vehicleId);
    if (!partnerVehicle || partnerVehicle.ownershipStatus !== 'ACTIVE') {
      throw new NotFoundError('Vehicle not found in your fleet.');
    }

    const auditData = {
      actorUserId: userId,
      action: isActive ? 'VEHICLE_ACTIVATED_BY_PARTNER' : 'VEHICLE_DEACTIVATED_BY_PARTNER',
      entityName: 'vehicles',
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    };

    await this.repo.setVehicleActiveStatus(vehicleId, isActive, auditData);

    const updated = await this.repo.findVehicleById(vehicleId);
    return this.serializeVehicle(
      {
        ...updated!,
        partnerVehicles: [partnerVehicle],
      },
      partner
    );
  }

  /**
   * Upload vehicle document (immutable replacement history)
   */
  public async uploadDocument(
    userIdStr: string,
    vehicleIdStr: string,
    input: UploadVehicleDocumentInput,
    file?: Express.Multer.File
  ): Promise<VehicleDocumentResponse> {
    const userId = BigInt(userIdStr);
    const vehicleId = BigInt(vehicleIdStr);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const partnerVehicle = await this.repo.findPartnerVehicleById(partner.id, vehicleId);
    if (!partnerVehicle || partnerVehicle.ownershipStatus !== 'ACTIVE') {
      throw new ForbiddenError('Cannot upload documents for inactive or non-fleet vehicle.');
    }

    let storageKey = input.documentStorageKey;

    if (file) {
      this.storage.validateFile(file);
      const uploadResult = await this.storage.uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        'vehicles'
      );
      storageKey = uploadResult.storageKey;
    }

    if (!storageKey) {
      throw new BadRequestError('Either physical file or valid documentStorageKey is required.');
    }

    let parsedExpiry: Date | null = null;
    if (input.expiryDate) {
      parsedExpiry = DateUtil.toCalendarMidnight(input.expiryDate);
    }

    // Insert new immutable row into vehicle_documents
    const doc = await this.repo.createVehicleDocument({
      vehicleId,
      documentType: input.documentType,
      documentStorageKey: storageKey,
      expiryDate: parsedExpiry,
    });

    logger.info(
      `[Vehicle Document Upload] Partner ${partner.id} uploaded ${input.documentType} for vehicle ${vehicleId}`
    );

    return this.serializeDocument(doc);
  }

  /**
   * List all documents for vehicle
   */
  public async getVehicleDocuments(
    userIdStr: string,
    vehicleIdStr: string
  ): Promise<VehicleDocumentResponse[]> {
    const userId = BigInt(userIdStr);
    const vehicleId = BigInt(vehicleIdStr);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const partnerVehicle = await this.repo.findPartnerVehicleById(partner.id, vehicleId);
    if (!partnerVehicle) {
      throw new NotFoundError('Vehicle not found in your fleet.');
    }

    const docs = await this.repo.findVehicleDocuments(vehicleId);
    return docs.map((d) => this.serializeDocument(d));
  }

  /**
   * Securely stream uploaded vehicle document binary
   */
  public async getDocumentFile(
    userIdStr: string,
    vehicleIdStr: string,
    docIdStr: string
  ): Promise<{ buffer: Buffer; mimeType: string; doc: any }> {
    const userId = BigInt(userIdStr);
    const vehicleId = BigInt(vehicleIdStr);
    const docId = BigInt(docIdStr);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const partnerVehicle = await this.repo.findPartnerVehicleById(partner.id, vehicleId);
    if (!partnerVehicle) {
      throw new NotFoundError('Vehicle not found in your fleet.');
    }

    const doc = await this.repo.findVehicleDocumentById(docId);
    if (!doc || doc.vehicleId !== vehicleId) {
      throw new NotFoundError('Document not found for this vehicle.');
    }

    const file = await this.storage.getFile(doc.documentStorageKey);
    return {
      buffer: file.buffer,
      mimeType: file.mimeType,
      doc,
    };
  }

  /**
   * Dynamic Operational Eligibility Evaluator
   */
  public async evaluateVehicleOperationalEligibility(
    vehicle: any,
    partner: any
  ): Promise<VehicleOperationalEligibility> {
    const reasons: string[] = [];

    // 1. Vehicle active status
    if (!vehicle.isActive) {
      reasons.push('Vehicle is deactivated by partner.');
    }

    // 2. Partner approval status
    if (partner.approvalStatus !== 'APPROVED') {
      reasons.push(`Partner account status is ${partner.approvalStatus.toLowerCase()}.`);
    }

    // 3. Vehicle verification status
    if (vehicle.verificationStatus !== 'VERIFIED') {
      reasons.push(`Vehicle verification status is ${vehicle.verificationStatus.toLowerCase()}.`);
    }

    // 4. KYC Policy & Document Expiry Engine
    const activeRel = vehicle.partnerVehicles?.[0];
    const ownershipType = activeRel?.ownershipType || 'OWNER';

    const latestDocs = await this.repo.findLatestDocumentsByVehicle(vehicle.id);

    const kycResult = await this.kycValidator.validateForApproval(
      {
        typeCode: vehicle.vehicleType?.typeCode || '',
        ownershipType,
      },
      latestDocs
    );

    if (!kycResult.isValid) {
      reasons.push(...kycResult.reasons);
    }

    const isOperational = reasons.length === 0;

    return {
      isOperational,
      canAcceptBookings: isOperational,
      reasons,
    };
  }

  /**
   * Helper serializing Vehicle model to API DTO
   */
  private async serializeVehicle(vehicle: any, partner: any): Promise<VehicleResponse> {
    const activeRel = vehicle.partnerVehicles?.find(
      (pv: any) => pv.ownershipStatus === 'ACTIVE'
    ) || vehicle.partnerVehicles?.[0];

    const operationalEligibility = await this.evaluateVehicleOperationalEligibility(
      vehicle,
      partner
    );

    const documents = vehicle.documents
      ? vehicle.documents.map((d: any) => this.serializeDocument(d))
      : undefined;

    return {
      id: vehicle.id.toString(),
      vehicleTypeId: vehicle.vehicleTypeId.toString(),
      vehicleType: {
        typeCode: vehicle.vehicleType?.typeCode || '',
        typeName: vehicle.vehicleType?.typeName || '',
        displayName: vehicle.vehicleType?.typeName || '',
        capacityKg: Number(vehicle.vehicleType?.capacityKg || 0),
        volumeCuft: vehicle.vehicleType?.volumeCuft ? Number(vehicle.vehicleType.volumeCuft) : null,
        serviceCategoryId: vehicle.vehicleType?.serviceCategoryId?.toString() || '',
      },
      registrationNumber: vehicle.registrationNumber,
      make: vehicle.make,
      model: vehicle.model,
      manufacturingYear: vehicle.manufacturingYear,
      rcNumber: vehicle.rcNumber,
      verificationStatus: vehicle.verificationStatus,
      rejectionReason: vehicle.rejectionReason,
      isActive: vehicle.isActive,
      isPrimary: activeRel?.isPrimary ?? false,
      operationalStatus: operationalEligibility.isOperational,
      hasExpiredDocuments:
        operationalEligibility.reasons.some((r: string) => r.toLowerCase().includes('expired')) ||
        (vehicle.documents
          ? vehicle.documents.some((d: any) => DateUtil.evaluateCalendarExpiry(d.expiryDate).isExpired)
          : false),
      ownership: {
        ownershipType: activeRel?.ownershipType || 'OWNER',
        ownerName: activeRel?.ownerName || null,
        ownershipStatus: activeRel?.ownershipStatus || 'ACTIVE',
        isPrimary: activeRel?.isPrimary ?? false,
        assignedAt: activeRel?.assignedAt ? activeRel.assignedAt.toISOString() : vehicle.createdAt.toISOString(),
        unassignedAt: activeRel?.unassignedAt ? activeRel.unassignedAt.toISOString() : null,
      },
      operationalEligibility,
      documents,
      createdAt: vehicle.createdAt.toISOString(),
      updatedAt: vehicle.updatedAt.toISOString(),
    };
  }

  /**
   * Helper serializing VehicleDocument model to API DTO with calendar expiry evaluation
   */
  public serializeDocument(doc: any): VehicleDocumentResponse {
    const expiryEvaluation = DateUtil.evaluateCalendarExpiry(doc.expiryDate);

    return {
      id: doc.id.toString(),
      vehicleId: doc.vehicleId.toString(),
      documentType: doc.documentType,
      documentStorageKey: doc.documentStorageKey,
      expiryDate: doc.expiryDate ? doc.expiryDate.toISOString().split('T')[0] : null,
      verificationStatus: doc.verificationStatus,
      rejectionReason: doc.rejectionReason,
      reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
      reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
      uploadedAt: doc.uploadedAt.toISOString(),
      expiryEvaluation,
      isExpired: expiryEvaluation.isExpired,
      isExpiringSoon: expiryEvaluation.isExpiringSoon,
      daysRemaining: expiryEvaluation.daysRemaining,
    };
  }
}

export const vehicleService = new VehicleService();

