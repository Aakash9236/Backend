import { Prisma, WorkerSkill } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateWorkerSkillData,
  UpdateWorkerSkillVerificationData,
  PaginationOptions,
  PaginatedResult,
} from '../workers.types';
import { handleWorkerDbError } from '../utils/worker-db-error.util';

export class WorkerSkillRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Create a new worker skill record
   */
  public async create(
    data: CreateWorkerSkillData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerSkill> {
    try {
      const client = this.getClient(tx);
      return await client.workerSkill.create({
        data: {
          workerId: data.workerId,
          serviceCategoryId: data.serviceCategoryId,
          experienceYears: data.experienceYears ?? 0,
          verificationStatus: data.verificationStatus ?? 'PENDING',
          rejectionReason: data.rejectionReason ?? null,
          isActive: data.isActive ?? true,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to create worker skill record');
    }
  }

  /**
   * Find skill by ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerSkill | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerSkill.findUnique({
        where: { id },
        include: {
          worker: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              workerType: true,
            },
          },
          serviceCategory: {
            select: {
              id: true,
              categoryName: true,
              categoryCode: true,
            },
          },
          reviewer: {
            select: {
              id: true,
              mobileNumber: true,
              email: true,
            },
          },
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find worker skill by ID');
    }
  }

  /**
   * List all skills for a worker
   */
  public async findByWorkerId(
    workerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerSkill[]> {
    try {
      const client = this.getClient(tx);
      return await client.workerSkill.findMany({
        where: { workerId },
        orderBy: { createdAt: 'asc' },
        include: {
          serviceCategory: {
            select: {
              id: true,
              categoryName: true,
              categoryCode: true,
            },
          },
          reviewer: {
            select: {
              id: true,
              mobileNumber: true,
              email: true,
            },
          },
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to list worker skills');
    }
  }

  /**
   * Find specific skill for a worker and service category
   */
  public async findByCategory(
    workerId: bigint,
    serviceCategoryId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerSkill | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerSkill.findUnique({
        where: {
          workerId_serviceCategoryId: {
            workerId,
            serviceCategoryId,
          },
        },
        include: {
          serviceCategory: {
            select: {
              id: true,
              categoryName: true,
              categoryCode: true,
            },
          },
          reviewer: {
            select: {
              id: true,
              mobileNumber: true,
              email: true,
            },
          },
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find worker skill by category');
    }
  }

  /**
   * Update skill verification status and reviewer metadata
   */
  public async updateVerificationStatus(
    id: bigint,
    data: UpdateWorkerSkillVerificationData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerSkill> {
    try {
      const client = this.getClient(tx);
      return await client.workerSkill.update({
        where: { id },
        data: {
          verificationStatus: data.verificationStatus,
          reviewedBy: data.reviewedBy ?? null,
          reviewedAt: data.reviewedAt ?? new Date(),
          rejectionReason: data.rejectionReason ?? null,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker skill verification status');
    }
  }

  /**
   * Delete a worker skill record
   */
  public async delete(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerSkill> {
    try {
      const client = this.getClient(tx);
      return await client.workerSkill.delete({
        where: { id },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to delete worker skill record');
    }
  }

  /**
   * Query skills pending administrative review with pagination
   */
  public async findPendingVerification(
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<WorkerSkill>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.WorkerSkillWhereInput = {
        verificationStatus: 'PENDING',
      };

      const [items, total] = await Promise.all([
        client.workerSkill.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'asc' }, // FIFO review queue
          include: {
            worker: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                approvalStatus: true,
                user: {
                  select: {
                    id: true,
                    mobileNumber: true,
                  },
                },
              },
            },
            serviceCategory: {
              select: {
                id: true,
                categoryName: true,
                categoryCode: true,
              },
            },
          },
        }),
        client.workerSkill.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to query pending verification worker skills');
    }
  }
}

export const workerSkillRepository = new WorkerSkillRepository();
