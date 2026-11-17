import { Prisma, DriverDocument } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateDriverDocumentData,
  UpdateDriverDocumentVerificationData,
  PaginationOptions,
  PaginatedResult,
} from '../drivers.types';
import { handleDriverDbError } from '../utils/driver-db-error.util';

export class DriverDocumentRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Create a new document record.
   * Document replacement is always additive: creating a new record preserves the previous history.
   */
  public async create(
    data: CreateDriverDocumentData,
    tx?: Prisma.TransactionClient
  ): Promise<DriverDocument> {
    try {
      const client = this.getClient(tx);
      return await client.driverDocument.create({
        data: {
          driverId: data.driverId,
          documentType: data.documentType,
          documentStorageKey: data.documentStorageKey,
          expiryDate: data.expiryDate ?? null,
          verificationStatus: data.verificationStatus ?? 'PENDING',
          rejectionReason: data.rejectionReason ?? null,
          documentMetadata: data.documentMetadata ?? Prisma.DbNull,
          reviewedBy: data.reviewedBy ?? null,
          reviewedAt: data.reviewedAt ?? null,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to create driver document record');
    }
  }

  /**
   * Find document by ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverDocument | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverDocument.findUnique({
        where: { id },
        include: {
          driver: {
            include: {
              user: {
                select: {
                  id: true,
                  mobileNumber: true,
                  email: true,
                },
              },
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
      handleDriverDbError(error, 'Failed to find driver document by ID');
    }
  }

  /**
   * List all documents for a driver, ordered chronologically (newest first)
   */
  public async findByDriverId(
    driverId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverDocument[]> {
    try {
      const client = this.getClient(tx);
      return await client.driverDocument.findMany({
        where: { driverId },
        orderBy: { uploadedAt: 'desc' },
        include: {
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
      handleDriverDbError(error, 'Failed to list driver documents');
    }
  }

  /**
   * Find latest document of each type for a driver
   */
  public async findLatestByDriver(
    driverId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverDocument[]> {
    try {
      const all = await this.findByDriverId(driverId, tx);
      const map = new Map<string, DriverDocument>();
      for (const doc of all) {
        if (!map.has(doc.documentType)) {
          map.set(doc.documentType, doc);
        }
      }
      return Array.from(map.values());
    } catch (error) {
      handleDriverDbError(error, 'Failed to list latest driver documents');
    }
  }

  /**
   * Find latest document for a driver by documentType
   */
  public async findLatestByType(
    driverId: bigint,
    documentType: string,
    tx?: Prisma.TransactionClient
  ): Promise<DriverDocument | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverDocument.findFirst({
        where: {
          driverId,
          documentType,
        },
        orderBy: { uploadedAt: 'desc' },
        include: {
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
      handleDriverDbError(error, 'Failed to find latest driver document by type');
    }
  }

  /**
   * Query documents pending administrative review with pagination
   */
  public async findPendingVerification(
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverDocument>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.DriverDocumentWhereInput = {
        verificationStatus: 'PENDING',
      };

      const [items, total] = await Promise.all([
        client.driverDocument.findMany({
          where,
          skip,
          take: limit,
          orderBy: { uploadedAt: 'asc' }, // FIFO review queue
          include: {
            driver: {
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
          },
        }),
        client.driverDocument.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleDriverDbError(error, 'Failed to query pending verification documents');
    }
  }

  /**
   * Update document verification status and reviewer metadata
   */
  public async updateVerificationStatus(
    id: bigint,
    data: UpdateDriverDocumentVerificationData,
    tx?: Prisma.TransactionClient
  ): Promise<DriverDocument> {
    try {
      const client = this.getClient(tx);
      return await client.driverDocument.update({
        where: { id },
        data: {
          verificationStatus: data.verificationStatus,
          reviewedBy: data.reviewedBy ?? null,
          reviewedAt: data.reviewedAt ?? new Date(),
          rejectionReason: data.rejectionReason ?? null,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to update document verification status');
    }
  }
}

export const driverDocumentRepository = new DriverDocumentRepository();

