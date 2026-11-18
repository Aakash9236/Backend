import { Prisma, DriverProfile } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateDriverProfileData,
  UpdateDriverProfileData,
  DriverProfileFilter,
  PaginationOptions,
  PaginatedResult,
} from '../drivers.types';
import { handleDriverDbError } from '../utils/driver-db-error.util';

export class DriverProfileRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Find driver profile by ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverProfile | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverProfile.findUnique({
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
      handleDriverDbError(error, 'Failed to fetch driver profile by ID');
    }
  }

  /**
   * Find driver profile by User ID
   */
  public async findByUserId(
    userId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverProfile | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverProfile.findUnique({
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
      handleDriverDbError(error, 'Failed to fetch driver profile by user ID');
    }
  }

  /**
   * Create a new driver profile
   */
  public async create(
    data: CreateDriverProfileData,
    tx?: Prisma.TransactionClient
  ): Promise<DriverProfile> {
    try {
      const client = this.getClient(tx);
      return await client.driverProfile.create({
        data: {
          userId: data.userId,
          firstName: data.firstName,
          lastName: data.lastName ?? null,
          dateOfBirth: data.dateOfBirth ?? null,
          gender: data.gender ?? null,
          profileImageUrl: data.profileImageUrl ?? null,
          bio: data.bio ?? null,
          experienceYears: data.experienceYears ?? 0,
          licenceNumber: data.licenceNumber ?? null,
          licenceClasses: data.licenceClasses ?? [],
          licenceExpiryDate: data.licenceExpiryDate ?? null,
          issuingAuthority: data.issuingAuthority ?? null,
          approvalStatus: data.approvalStatus ?? 'PENDING',
          submissionStatus: data.submissionStatus ?? 'DRAFT',
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to create driver profile');
    }
  }

  /**
   * Update general profile fields
   */
  public async update(
    id: bigint,
    data: UpdateDriverProfileData,
    tx?: Prisma.TransactionClient
  ): Promise<DriverProfile> {
    try {
      const client = this.getClient(tx);
      return await client.driverProfile.update({
        where: { id },
        data: {
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth } : {}),
          ...(data.gender !== undefined ? { gender: data.gender } : {}),
          ...(data.profileImageUrl !== undefined ? { profileImageUrl: data.profileImageUrl } : {}),
          ...(data.bio !== undefined ? { bio: data.bio } : {}),
          ...(data.experienceYears !== undefined ? { experienceYears: data.experienceYears } : {}),
          ...(data.licenceNumber !== undefined ? { licenceNumber: data.licenceNumber } : {}),
          ...(data.licenceClasses !== undefined ? { licenceClasses: data.licenceClasses } : {}),
          ...(data.licenceExpiryDate !== undefined ? { licenceExpiryDate: data.licenceExpiryDate } : {}),
          ...(data.issuingAuthority !== undefined ? { issuingAuthority: data.issuingAuthority } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to update driver profile');
    }
  }

  /**
   * Update profile submission status (e.g. SUBMITTED, UNDER_REVIEW)
   */
  public async updateSubmissionStatus(
    id: bigint,
    submissionStatus: string,
    submittedAt?: Date | null,
    tx?: Prisma.TransactionClient
  ): Promise<DriverProfile> {
    try {
      const client = this.getClient(tx);
      return await client.driverProfile.update({
        where: { id },
        data: {
          submissionStatus,
          ...(submittedAt !== undefined ? { submittedAt } : {}),
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to update driver submission status');
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
  ): Promise<DriverProfile> {
    try {
      const client = this.getClient(tx);
      return await client.driverProfile.update({
        where: { id },
        data: {
          approvalStatus,
          reviewedBy: reviewerId ?? null,
          reviewedAt: new Date(),
          rejectionReason: rejectionReason ?? null,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to update driver approval status');
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
  ): Promise<DriverProfile> {
    try {
      const client = this.getClient(tx);
      return await client.driverProfile.update({
        where: { id },
        data: {
          approvalStatus,
          suspensionReason: suspensionReason ?? null,
          suspendedAt: suspendedAt !== undefined ? suspendedAt : approvalStatus === 'SUSPENDED' ? new Date() : null,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to update driver suspension status');
    }
  }

  /**
   * Paginated listing of driver profiles with flexible filtering and sorting
   */
  public async findMany(
    filter?: DriverProfileFilter,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverProfile>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.DriverProfileWhereInput = {
        ...(filter?.approvalStatus ? { approvalStatus: filter.approvalStatus } : {}),
        ...(filter?.submissionStatus ? { submissionStatus: filter.submissionStatus } : {}),
        ...(filter?.isActive !== undefined ? { isActive: filter.isActive } : {}),
        ...(filter?.licenceNumber ? { licenceNumber: filter.licenceNumber } : {}),
        ...(filter?.search
          ? {
              OR: [
                { firstName: { contains: filter.search, mode: 'insensitive' } },
                { lastName: { contains: filter.search, mode: 'insensitive' } },
                { licenceNumber: { contains: filter.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.DriverProfileOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { createdAt: 'desc' };

      const [items, total] = await Promise.all([
        client.driverProfile.findMany({
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
              },
            },
          },
        }),
        client.driverProfile.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleDriverDbError(error, 'Failed to query driver profiles');
    }
  }
}

export const driverProfileRepository = new DriverProfileRepository();

