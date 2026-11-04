import { prisma } from '../../config/db.config';
import { VehicleAuditLogData } from './vehicles.types';

export class VehicleRepository {
  public async findVehicleTypes(serviceCategoryId?: bigint) {
    return prisma.vehicleType.findMany({
      where: {
        isActive: true,
        ...(serviceCategoryId ? { serviceCategoryId } : {}),
      },
      include: {
        category: true,
      },
      orderBy: {
        capacityKg: 'asc',
      },
    });
  }

  public async findVehicleTypeById(id: bigint) {
    return prisma.vehicleType.findUnique({
      where: { id },
      include: { category: true },
    });
  }

  public async findVehicleByRegistration(normalizedReg: string) {
    return prisma.vehicle.findUnique({
      where: { registrationNumber: normalizedReg },
      include: {
        vehicleType: true,
        partnerVehicles: {
          where: { ownershipStatus: 'ACTIVE', unassignedAt: null },
          include: { partner: true },
        },
      },
    });
  }

  public async findVehicleById(vehicleId: bigint) {
    return prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        vehicleType: true,
        partnerVehicles: {
          where: { ownershipStatus: 'ACTIVE', unassignedAt: null },
          include: { partner: true },
        },
        documents: {
          orderBy: { uploadedAt: 'desc' },
        },
      },
    });
  }

  public async findActivePartnerVehicle(vehicleId: bigint) {
    return prisma.partnerVehicle.findFirst({
      where: {
        vehicleId,
        ownershipStatus: 'ACTIVE',
        unassignedAt: null,
      },
      include: {
        partner: true,
        vehicle: {
          include: { vehicleType: true },
        },
      },
    });
  }

  public async findPartnerVehicles(partnerId: bigint, ownershipStatus: string = 'ACTIVE') {
    return prisma.partnerVehicle.findMany({
      where: {
        partnerId,
        ...(ownershipStatus ? { ownershipStatus } : {}),
      },
      include: {
        vehicle: {
          include: {
            vehicleType: true,
            documents: {
              orderBy: { uploadedAt: 'desc' },
            },
          },
        },
      },
      orderBy: [
        { isPrimary: 'desc' },
        { assignedAt: 'desc' },
      ],
    });
  }

  public async findPartnerVehicleById(partnerId: bigint, vehicleId: bigint) {
    return prisma.partnerVehicle.findFirst({
      where: {
        partnerId,
        vehicleId,
      },
      include: {
        vehicle: {
          include: {
            vehicleType: true,
            documents: {
              orderBy: { uploadedAt: 'desc' },
            },
          },
        },
      },
    });
  }

  public async createVehicleWithOwnership(
    partnerId: bigint,
    vehicleData: {
      vehicleTypeId: bigint;
      registrationNumber: string;
      make?: string;
      model?: string;
      manufacturingYear?: number;
      rcNumber?: string;
    },
    ownershipData: {
      ownershipType: string;
      ownerName?: string;
      isPrimary?: boolean;
    },
    auditData: VehicleAuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      // 1. Create vehicle record
      const vehicle = await tx.vehicle.create({
        data: {
          vehicleTypeId: vehicleData.vehicleTypeId,
          registrationNumber: vehicleData.registrationNumber,
          make: vehicleData.make || null,
          model: vehicleData.model || null,
          manufacturingYear: vehicleData.manufacturingYear || null,
          rcNumber: vehicleData.rcNumber || null,
          verificationStatus: 'PENDING',
          isActive: true,
        },
      });

      // 2. Check if partner already has vehicles to set isPrimary
      const existingCount = await tx.partnerVehicle.count({
        where: { partnerId, ownershipStatus: 'ACTIVE' },
      });

      const isPrimary = ownershipData.isPrimary ?? existingCount === 0;

      // If this is set to primary, unset any previous primary
      if (isPrimary && existingCount > 0) {
        await tx.partnerVehicle.updateMany({
          where: { partnerId, ownershipStatus: 'ACTIVE' },
          data: { isPrimary: false },
        });
      }

      // 3. Create partner_vehicle active record
      const partnerVehicle = await tx.partnerVehicle.create({
        data: {
          partnerId,
          vehicleId: vehicle.id,
          isPrimary,
          ownershipType: ownershipData.ownershipType,
          ownerName: ownershipData.ownerName || null,
          ownershipStatus: 'ACTIVE',
        },
      });

      // 4. Record audit log
      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: vehicle.id,
          oldValues: undefined,
          newValues: {
            registrationNumber: vehicle.registrationNumber,
            ownershipType: ownershipData.ownershipType,
            ownerName: ownershipData.ownerName,
            partnerId: partnerId.toString(),
          },
          ipAddress: auditData.ipAddress || null,
          userAgent: auditData.userAgent || null,
        },
      });

      return {
        ...vehicle,
        partnerVehicle,
      };
    });
  }

  public async updateVehicle(
    vehicleId: bigint,
    updateData: {
      make?: string;
      model?: string;
      manufacturingYear?: number;
      rcNumber?: string;
    }
  ) {
    return prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        ...(updateData.make !== undefined ? { make: updateData.make } : {}),
        ...(updateData.model !== undefined ? { model: updateData.model } : {}),
        ...(updateData.manufacturingYear !== undefined
          ? { manufacturingYear: updateData.manufacturingYear }
          : {}),
        ...(updateData.rcNumber !== undefined ? { rcNumber: updateData.rcNumber } : {}),
      },
      include: {
        vehicleType: true,
      },
    });
  }

  public async setPrimaryVehicle(partnerId: bigint, vehicleId: bigint) {
    return prisma.$transaction(async (tx) => {
      await tx.partnerVehicle.updateMany({
        where: { partnerId, ownershipStatus: 'ACTIVE' },
        data: { isPrimary: false },
      });

      return tx.partnerVehicle.updateMany({
        where: { partnerId, vehicleId, ownershipStatus: 'ACTIVE' },
        data: { isPrimary: true },
      });
    });
  }

  public async setVehicleActiveStatus(
    vehicleId: bigint,
    isActive: boolean,
    auditData: VehicleAuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: { isActive },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: vehicleId,
          newValues: { isActive },
          ipAddress: auditData.ipAddress || null,
          userAgent: auditData.userAgent || null,
        },
      });

      return updated;
    });
  }

  public async createVehicleDocument(data: {
    vehicleId: bigint;
    documentType: string;
    documentStorageKey: string;
    expiryDate?: Date | null;
  }) {
    return prisma.vehicleDocument.create({
      data: {
        vehicleId: data.vehicleId,
        documentType: data.documentType,
        documentStorageKey: data.documentStorageKey,
        expiryDate: data.expiryDate || null,
        verificationStatus: 'PENDING',
      },
    });
  }

  public async findVehicleDocuments(vehicleId: bigint) {
    return prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { uploadedAt: 'desc' },
      include: {
        reviewer: {
          select: { id: true, mobileNumber: true, email: true },
        },
      },
    });
  }

  public async findVehicleDocumentById(docId: bigint) {
    return prisma.vehicleDocument.findUnique({
      where: { id: docId },
      include: {
        vehicle: {
          include: {
            vehicleType: true,
            partnerVehicles: {
              where: { ownershipStatus: 'ACTIVE' },
              include: { partner: true },
            },
          },
        },
        reviewer: true,
      },
    });
  }

  public async findLatestDocumentsByVehicle(vehicleId: bigint) {
    // Fetches all documents ordered by uploadedAt descending
    const allDocs = await prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { uploadedAt: 'desc' },
    });

    // Group to pick the single newest document per documentType
    const latestMap = new Map<string, (typeof allDocs)[0]>();
    for (const doc of allDocs) {
      if (!latestMap.has(doc.documentType)) {
        latestMap.set(doc.documentType, doc);
      }
    }

    return Array.from(latestMap.values());
  }

  public async updateDocumentStatusWithAudit(
    docId: bigint,
    status: string,
    reason: string | null,
    reviewerId: bigint,
    auditData: VehicleAuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vehicleDocument.update({
        where: { id: docId },
        data: {
          verificationStatus: status,
          rejectionReason: reason,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: docId,
          newValues: { status, reason, reviewerId: reviewerId.toString() },
          ipAddress: auditData.ipAddress || null,
          userAgent: auditData.userAgent || null,
        },
      });

      return updated;
    });
  }

  public async approveVehicleWithAudit(
    vehicleId: bigint,
    reviewerId: bigint,
    auditData: VehicleAuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          verificationStatus: 'VERIFIED',
          rejectionReason: null,
        },
        include: {
          vehicleType: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: vehicleId,
          newValues: { verificationStatus: 'VERIFIED', reviewerId: reviewerId.toString() },
          ipAddress: auditData.ipAddress || null,
          userAgent: auditData.userAgent || null,
        },
      });

      return updated;
    });
  }

  public async rejectVehicleWithAudit(
    vehicleId: bigint,
    reason: string,
    reviewerId: bigint,
    auditData: VehicleAuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          verificationStatus: 'REJECTED',
          rejectionReason: reason,
        },
        include: {
          vehicleType: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: vehicleId,
          newValues: { verificationStatus: 'REJECTED', rejectionReason: reason, reviewerId: reviewerId.toString() },
          ipAddress: auditData.ipAddress || null,
          userAgent: auditData.userAgent || null,
        },
      });

      return updated;
    });
  }

  public async suspendVehicleWithAudit(
    vehicleId: bigint,
    reason: string,
    reviewerId: bigint,
    auditData: VehicleAuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          verificationStatus: 'SUSPENDED',
          rejectionReason: reason,
        },
        include: {
          vehicleType: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: vehicleId,
          newValues: { verificationStatus: 'SUSPENDED', suspensionReason: reason, reviewerId: reviewerId.toString() },
          ipAddress: auditData.ipAddress || null,
          userAgent: auditData.userAgent || null,
        },
      });

      return updated;
    });
  }

  public async reactivateVehicleWithAudit(
    vehicleId: bigint,
    reviewerId: bigint,
    auditData: VehicleAuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          verificationStatus: 'VERIFIED',
          rejectionReason: null,
        },
        include: {
          vehicleType: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: vehicleId,
          newValues: { verificationStatus: 'VERIFIED', reactivatedBy: reviewerId.toString() },
          ipAddress: auditData.ipAddress || null,
          userAgent: auditData.userAgent || null,
        },
      });

      return updated;
    });
  }

  public async transferVehicleOwnershipWithAudit(
    vehicleId: bigint,
    oldPartnerId: bigint,
    newPartnerId: bigint,
    transferData: {
      transferReason: string;
      newOwnershipType?: string;
      newOwnerName?: string;
    },
    auditData: VehicleAuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      const now = new Date();

      // 1. Close old relationship permanently
      await tx.partnerVehicle.updateMany({
        where: {
          vehicleId,
          partnerId: oldPartnerId,
          ownershipStatus: 'ACTIVE',
        },
        data: {
          ownershipStatus: 'TRANSFERRED',
          unassignedAt: now,
          isPrimary: false,
        },
      });

      // 2. Insert new active relationship for target partner
      const newRelationship = await tx.partnerVehicle.create({
        data: {
          partnerId: newPartnerId,
          vehicleId,
          ownershipType: transferData.newOwnershipType || 'OWNER',
          ownerName: transferData.newOwnerName || null,
          ownershipStatus: 'ACTIVE',
          assignedAt: now,
          unassignedAt: null,
          isPrimary: false,
        },
      });

      // 3. Reset vehicle verification status to PENDING for re-verification
      const vehicle = await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          verificationStatus: 'PENDING',
          rejectionReason: `Ownership transferred from Partner ${oldPartnerId} to Partner ${newPartnerId}`,
        },
      });

      // 4. Record atomic audit log
      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: vehicleId,
          oldValues: { partnerId: oldPartnerId.toString() },
          newValues: {
            newPartnerId: newPartnerId.toString(),
            reason: transferData.transferReason,
            ownershipType: transferData.newOwnershipType,
          },
          ipAddress: auditData.ipAddress || null,
          userAgent: auditData.userAgent || null,
        },
      });

      return {
        vehicle,
        newRelationship,
      };
    });
  }

  public async findPendingVehicles() {
    return prisma.vehicle.findMany({
      where: { verificationStatus: 'PENDING' },
      include: {
        vehicleType: true,
        partnerVehicles: {
          where: { ownershipStatus: 'ACTIVE' },
          include: { partner: true },
        },
        documents: {
          orderBy: { uploadedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const vehicleRepository = new VehicleRepository();

