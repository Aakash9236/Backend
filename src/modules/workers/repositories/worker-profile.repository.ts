import { Prisma, WorkerProfile } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateWorkerProfileData,
  UpdateWorkerProfileData,
  WorkerProfileFilter,
  PaginationOptions,
  PaginatedResult,
} from '../workers.types';
import { handleWorkerDbError } from '../utils/worker-db-error.util';

export class WorkerProfileRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Find worker profile by ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.findUnique({
        where: { id },
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
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to fetch worker profile by ID');
    }
  }

  /**
   * Find worker profile by User ID
   */
  public async findByUserId(
    userId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.findUnique({
        where: { userId },
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
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to fetch worker profile by user ID');
    }
  }

  /**
   * Create a new worker profile
   */
  public async create(
    data: CreateWorkerProfileData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.create({
        data: {
          userId: data.userId,
          firstName: data.firstName,
          lastName: data.lastName ?? null,
          dateOfBirth: data.dateOfBirth ?? null,
          gender: data.gender ?? null,
          profileImageUrl: data.profileImageUrl ?? null,
          bio: data.bio ?? null,
          workerType: data.workerType ?? 'HELPER',
          experienceYears: data.experienceYears ?? 0,
          primaryCityId: data.primaryCityId ?? null,
          approvalStatus: data.approvalStatus ?? 'PENDING',
          submissionStatus: data.submissionStatus ?? 'DRAFT',
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to create worker profile');
    }
  }

  /**
   * Update an existing worker profile
   */
  public async update(
    id: bigint,
    data: UpdateWorkerProfileData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id },
        data: {
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth } : {}),
          ...(data.gender !== undefined ? { gender: data.gender } : {}),
          ...(data.profileImageUrl !== undefined ? { profileImageUrl: data.profileImageUrl } : {}),
          ...(data.bio !== undefined ? { bio: data.bio } : {}),
          ...(data.workerType !== undefined ? { workerType: data.workerType } : {}),
          ...(data.experienceYears !== undefined ? { experienceYears: data.experienceYears } : {}),
          ...(data.primaryCityId !== undefined ? { primaryCityId: data.primaryCityId } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker profile');
    }
  }

  /**
   * Submit profile for onboarding / verification review
   */
  public async submitOnboarding(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id },
        data: {
          submissionStatus: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to submit worker onboarding');
    }
  }

  /**
   * Update profile submission status (e.g. SUBMITTED, UNDER_REVIEW, ACTION_REQUIRED)
   */
  public async updateSubmissionStatus(
    id: bigint,
    submissionStatus: string,
    submittedAt?: Date | null,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id },
        data: {
          submissionStatus,
          ...(submittedAt !== undefined ? { submittedAt } : {}),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker submission status');
    }
  }

  /**
   * Update administrative approval status (e.g. APPROVED, REJECTED)
   */
  public async updateApprovalStatus(
    id: bigint,
    approvalStatus: string,
    reviewerId?: bigint | null,
    rejectionReason?: string | null,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id },
        data: {
          approvalStatus,
          reviewedBy: reviewerId ?? null,
          reviewedAt: new Date(),
          rejectionReason: rejectionReason ?? null,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker approval status');
    }
  }

  /**
   * Update suspension status (SUSPENDED or reactivated to APPROVED)
   */
  public async updateSuspensionStatus(
    id: bigint,
    approvalStatus: string,
    suspensionReason?: string | null,
    suspendedAt?: Date | null,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerProfile> {
    try {
      const client = this.getClient(tx);
      return await client.workerProfile.update({
        where: { id },
        data: {
          approvalStatus,
          suspensionReason: suspensionReason ?? null,
          suspendedAt: suspendedAt !== undefined ? suspendedAt : approvalStatus === 'SUSPENDED' ? new Date() : null,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker suspension status');
    }
  }

  /**
   * Paginated listing of worker profiles with flexible filtering and sorting
   */
  public async findMany(
    filter?: WorkerProfileFilter,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<WorkerProfile>> {
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
              ],
            }
          : {}),
      };

      const sortField = options?.sortBy || 'createdAt';
      const sortDirection: Prisma.SortOrder = options?.sortOrder === 'asc' ? 'asc' : 'desc';
      const orderBy: Prisma.WorkerProfileOrderByWithRelationInput = {
        [sortField]: sortDirection,
      };

      const [items, total] = await Promise.all([
        client.workerProfile.findMany({
          where,
          skip,
          take: limit,
          orderBy,
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
          },
        }),
        client.workerProfile.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to list worker profiles');
    }
  }
}

export const workerProfileRepository = new WorkerProfileRepository();
