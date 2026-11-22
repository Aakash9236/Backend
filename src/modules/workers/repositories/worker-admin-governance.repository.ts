import { Prisma, WorkerProfile } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { handleWorkerDbError } from '../utils/worker-db-error.util';
import { PaginationOptions, PaginatedResult } from '../workers.types';

export interface WorkerGovernanceFilter {
  approvalStatus?: string;
  submissionStatus?: string;
  workerType?: string;
  primaryCityId?: bigint;
  isActive?: boolean;
  search?: string;
}

export class WorkerAdminGovernanceRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Paginated listing of worker applications with comprehensive relation loading for admin triage.
   */
  public async findApplications(
    filter?: WorkerGovernanceFilter,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<any>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.WorkerProfileWhereInput = {
        ...(filter?.approvalStatus ? { approvalStatus: filter.approvalStatus } : {}),
        ...(filter?.submissionStatus ? { submissionStatus: filter.submissionStatus } : {}),
        ...(filter?.workerType ? { workerType: filter.workerType } : {}),
        ...(filter?.primaryCityId ? { primaryCityId: filter.primaryCityId } : {}),
        ...(filter?.isActive !== undefined ? { isActive: filter.isActive } : {}),
        ...(filter?.search
          ? {
              OR: [
                { firstName: { contains: filter.search, mode: 'insensitive' } },
                { lastName: { contains: filter.search, mode: 'insensitive' } },
                { user: { mobileNumber: { contains: filter.search } } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        client.workerProfile.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            user: {
              select: {
                id: true,
                mobileNumber: true,
                email: true,
                accountStatus: true,
                isMobileVerified: true,
              },
            },
            primaryCity: {
              select: {
                id: true,
                cityName: true,
                stateName: true,
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
              select: {
                id: true,
                documentType: true,
                verificationStatus: true,
                expiryDate: true,
                uploadedAt: true,
              },
              orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
            },
            skills: {
              select: {
                id: true,
                serviceCategoryId: true,
                verificationStatus: true,
                experienceYears: true,
              },
            },
          },
        }),
        client.workerProfile.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to fetch worker applications for admin review');
    }
  }

  /**
   * Retrieves complete worker application dossier for administrative inspection.
   */
  public async findGovernanceDossier(
    workerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<any | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.findUnique({
        where: { id: workerId },
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
          primaryCity: {
            select: {
              id: true,
              cityName: true,
              stateName: true,
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
            orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              workerId: true,
              documentType: true,
              originalName: true,
              mimeType: true,
              fileSizeBytes: true,
              expiryDate: true,
              verificationStatus: true,
              rejectionReason: true,
              documentMetadata: true,
              reviewedBy: true,
              reviewedAt: true,
              uploadedAt: true,
              // documentStorageKey is intentionally omitted from default dossier selection
            },
          },
          skills: {
            include: {
              serviceCategory: {
                select: {
                  id: true,
                  categoryCode: true,
                  categoryName: true,
                },
              },
            },
            orderBy: { id: 'asc' },
          },
          affiliations: {
            include: {
              partner: {
                select: {
                  id: true,
                  businessName: true,
                  legalName: true,
                  profileType: true,
                },
              },
            },
            orderBy: [{ affiliatedAt: 'desc' }, { id: 'desc' }],
          },
          availability: true,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to fetch worker governance dossier');
    }
  }

  /**
   * Conditionally updates worker profile to APPROVED status.
   */
  public async atomicApprove(
    workerId: bigint,
    adminUserId: bigint,
    timestamp: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id: workerId },
        data: {
          approvalStatus: 'APPROVED',
          submissionStatus: 'APPROVED',
          rejectionReason: null,
          suspendedAt: null,
          suspensionReason: null,
          reviewedBy: adminUserId,
          reviewedAt: timestamp,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker profile to APPROVED');
    }
  }

  /**
   * Conditionally updates worker profile to REJECTED status.
   */
  public async atomicReject(
    workerId: bigint,
    adminUserId: bigint,
    rejectionReason: string,
    timestamp: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id: workerId },
        data: {
          approvalStatus: 'REJECTED',
          submissionStatus: 'REJECTED',
          rejectionReason,
          reviewedBy: adminUserId,
          reviewedAt: timestamp,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker profile to REJECTED');
    }
  }

  /**
   * Conditionally updates worker profile to SUSPENDED status.
   */
  public async atomicSuspend(
    workerId: bigint,
    adminUserId: bigint,
    suspensionReason: string,
    timestamp: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id: workerId },
        data: {
          approvalStatus: 'SUSPENDED',
          suspendedAt: timestamp,
          suspensionReason,
          reviewedBy: adminUserId,
          reviewedAt: timestamp,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker profile to SUSPENDED');
    }
  }

  /**
   * Conditionally updates worker profile from SUSPENDED back to APPROVED (or previous status).
   */
  public async atomicReactivate(
    workerId: bigint,
    adminUserId: bigint,
    targetApprovalStatus: string = 'APPROVED',
    timestamp: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id: workerId },
        data: {
          approvalStatus: targetApprovalStatus,
          suspendedAt: null,
          suspensionReason: null,
          reviewedBy: adminUserId,
          reviewedAt: timestamp,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to reactivate worker profile');
    }
  }

  /**
   * Records an immutable audit log entry in the transaction.
   */
  public async recordAuditLog(
    data: {
      actorUserId: bigint;
      action: string;
      entityName: string;
      entityId: bigint;
      oldValues?: Prisma.InputJsonValue;
      newValues?: Prisma.InputJsonValue;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
    tx?: Prisma.TransactionClient
  ) {
    try {
      const client = this.getClient(tx);
      return await client.auditLog.create({
        data: {
          actorUserId: data.actorUserId,
          action: data.action,
          entityName: data.entityName,
          entityId: data.entityId,
          oldValues: data.oldValues ?? Prisma.JsonNull,
          newValues: data.newValues ?? Prisma.JsonNull,
          ipAddress: data.ipAddress ?? null,
          userAgent: data.userAgent ?? null,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to record administrative audit log');
    }
  }
}

export const workerAdminGovernanceRepository = new WorkerAdminGovernanceRepository();
