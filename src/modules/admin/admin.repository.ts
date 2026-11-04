import { prisma } from '../../config/db.config';
import { PartnerProfile, PartnerDocument, PartnerSkill } from '@prisma/client';

export interface AuditLogData {
  actorUserId: bigint;
  action: string;
  entityName: string;
  entityId: bigint;
  oldValues?: any;
  newValues?: any;
  ipAddress?: string;
  userAgent?: string;
}

export class AdminRepository {
  /**
   * Find all partner profiles with status PENDING
   */
  public async findPendingPartners(): Promise<PartnerProfile[]> {
    return prisma.partnerProfile.findMany({
      where: { approvalStatus: 'PENDING' },
      include: {
        user: {
          select: {
            id: true,
            mobileNumber: true,
            email: true,
            accountStatus: true,
          },
        },
        documents: true,
        skills: {
          include: { category: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find detailed partner profile by ID
   */
  public async findPartnerDetailById(partnerId: bigint) {
    return prisma.partnerProfile.findUnique({
      where: { id: partnerId },
      include: {
        user: {
          select: {
            id: true,
            mobileNumber: true,
            email: true,
            accountStatus: true,
            isMobileVerified: true,
            createdAt: true,
          },
        },
        reviewer: {
          select: {
            id: true,
            mobileNumber: true,
            email: true,
          },
        },
        documents: {
          include: {
            reviewer: {
              select: {
                id: true,
                mobileNumber: true,
              },
            },
          },
        },
        skills: {
          include: {
            category: true,
          },
        },
        serviceAreas: {
          include: {
            city: true,
            area: true,
          },
        },
      },
    });
  }

  /**
   * Atomically update partner approval status and record audit log in a single transaction
   */
  public async updatePartnerStatusWithAudit(
    partnerId: bigint,
    data: {
      status: string;
      reason?: string | null;
      adminUserId: bigint;
    },
    auditData: AuditLogData
  ): Promise<PartnerProfile> {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.partnerProfile.update({
        where: { id: partnerId },
        data: {
          approvalStatus: data.status,
          rejectionReason: data.reason || null,
          reviewedBy: data.adminUserId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: auditData.entityId,
          oldValues: auditData.oldValues ?? undefined,
          newValues: auditData.newValues ?? undefined,
          ipAddress: auditData.ipAddress ?? null,
          userAgent: auditData.userAgent ?? null,
        },
      });

      return updated;
    });
  }

  /**
   * Update partner approval status without audit log (internal / testing)
   */
  public async updatePartnerStatus(
    partnerId: bigint,
    data: {
      status: string;
      reason?: string | null;
      adminUserId: bigint;
    }
  ): Promise<PartnerProfile> {
    return prisma.partnerProfile.update({
      where: { id: partnerId },
      data: {
        approvalStatus: data.status,
        rejectionReason: data.reason || null,
        reviewedBy: data.adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Find document by ID
   */
  public async findDocumentById(documentId: bigint): Promise<PartnerDocument | null> {
    return prisma.partnerDocument.findUnique({
      where: { id: documentId },
    });
  }

  /**
   * Atomically update document verification status and record audit log in a single transaction
   */
  public async updateDocumentStatusWithAudit(
    documentId: bigint,
    data: {
      status: string;
      reason?: string | null;
      adminUserId: bigint;
    },
    auditData: AuditLogData
  ): Promise<PartnerDocument> {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.partnerDocument.update({
        where: { id: documentId },
        data: {
          verificationStatus: data.status,
          rejectionReason: data.reason || null,
          reviewedBy: data.adminUserId,
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: auditData.entityId,
          oldValues: auditData.oldValues ?? undefined,
          newValues: auditData.newValues ?? undefined,
          ipAddress: auditData.ipAddress ?? null,
          userAgent: auditData.userAgent ?? null,
        },
      });

      return updated;
    });
  }

  /**
   * Update document verification status
   */
  public async updateDocumentStatus(
    documentId: bigint,
    data: {
      status: string;
      reason?: string | null;
      adminUserId: bigint;
    }
  ): Promise<PartnerDocument> {
    return prisma.partnerDocument.update({
      where: { id: documentId },
      data: {
        verificationStatus: data.status,
        rejectionReason: data.reason || null,
        reviewedBy: data.adminUserId,
        reviewedAt: new Date(),
      },
    });
  }

  /**
   * Find skill by ID
   */
  public async findSkillById(skillId: bigint): Promise<PartnerSkill | null> {
    return prisma.partnerSkill.findUnique({
      where: { id: skillId },
      include: { category: true },
    });
  }

  /**
   * Atomically update skill verification status and record audit log in a single transaction
   */
  public async updateSkillStatusWithAudit(
    skillId: bigint,
    status: string,
    auditData: AuditLogData
  ): Promise<PartnerSkill> {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.partnerSkill.update({
        where: { id: skillId },
        data: {
          verificationStatus: status,
          updatedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: auditData.entityId,
          oldValues: auditData.oldValues ?? undefined,
          newValues: auditData.newValues ?? undefined,
          ipAddress: auditData.ipAddress ?? null,
          userAgent: auditData.userAgent ?? null,
        },
      });

      return updated;
    });
  }

  /**
   * Update skill verification status
   */
  public async updateSkillStatus(
    skillId: bigint,
    status: string
  ): Promise<PartnerSkill> {
    return prisma.partnerSkill.update({
      where: { id: skillId },
      data: {
        verificationStatus: status,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Find user with roles by ID
   */
  public async findUserWithRoles(userId: bigint) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });
  }

  /**
   * Find role by role name
   */
  public async findRoleByName(roleName: string) {
    return prisma.role.findUnique({
      where: { roleName },
    });
  }

  /**
   * Count users currently assigned to a role
   */
  public async countUsersWithRole(roleId: bigint): Promise<number> {
    return prisma.userRole.count({
      where: { roleId },
    });
  }

  /**
   * Atomically assign a role to a user and record audit log
   */
  public async assignRoleWithAudit(
    userId: bigint,
    roleId: bigint,
    auditData: AuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.userRole.findUnique({
        where: {
          userId_roleId: { userId, roleId },
        },
      });

      if (!existing) {
        await tx.userRole.create({
          data: { userId, roleId },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: auditData.entityId,
          oldValues: auditData.oldValues ?? undefined,
          newValues: auditData.newValues ?? undefined,
          ipAddress: auditData.ipAddress ?? null,
          userAgent: auditData.userAgent ?? null,
        },
      });

      return tx.user.findUnique({
        where: { id: userId },
        include: { userRoles: { include: { role: true } } },
      });
    });
  }

  /**
   * Atomically revoke a role from a user and record audit log
   */
  public async revokeRoleWithAudit(
    userId: bigint,
    roleId: bigint,
    auditData: AuditLogData
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId, roleId },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: auditData.actorUserId,
          action: auditData.action,
          entityName: auditData.entityName,
          entityId: auditData.entityId,
          oldValues: auditData.oldValues ?? undefined,
          newValues: auditData.newValues ?? undefined,
          ipAddress: auditData.ipAddress ?? null,
          userAgent: auditData.userAgent ?? null,
        },
      });

      return tx.user.findUnique({
        where: { id: userId },
        include: { userRoles: { include: { role: true } } },
      });
    });
  }

  /**
   * Record action in audit log table (standalone)
   */
  public async createAuditLog(data: AuditLogData): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorUserId: data.actorUserId,
        action: data.action,
        entityName: data.entityName,
        entityId: data.entityId,
        oldValues: data.oldValues ?? undefined,
        newValues: data.newValues ?? undefined,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  }
}

export const adminRepository = new AdminRepository();
