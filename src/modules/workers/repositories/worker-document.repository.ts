import { Prisma, WorkerDocument } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateWorkerDocumentData,
  UpdateWorkerDocumentVerificationData,
  PaginationOptions,
  PaginatedResult,
} from '../workers.types';
import { handleWorkerDbError } from '../utils/worker-db-error.util';

export class WorkerDocumentRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Create a new document record.
   * Document replacement is always additive: creating a new record preserves the previous history.
   */
  public async create(
    data: CreateWorkerDocumentData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerDocument> {
    try {
      const client = this.getClient(tx);
      return await client.workerDocument.create({
        data: {
          workerId: data.workerId,
          documentType: data.documentType,
          documentStorageKey: data.documentStorageKey,
          originalName: data.originalName ?? null,
          mimeType: data.mimeType ?? null,
          fileSizeBytes: data.fileSizeBytes !== undefined && data.fileSizeBytes !== null ? BigInt(data.fileSizeBytes) : null,
          expiryDate: data.expiryDate ?? null,
          verificationStatus: data.verificationStatus ?? 'PENDING',
          rejectionReason: data.rejectionReason ?? null,
          documentMetadata: data.documentMetadata ?? Prisma.DbNull,
          reviewedBy: data.reviewedBy ?? null,
          reviewedAt: data.reviewedAt ?? null,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to create worker document record');
    }
  }

  /**
   * Find document by ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerDocument | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerDocument.findUnique({
        where: { id },
        include: {
          worker: {
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
      handleWorkerDbError(error, 'Failed to find worker document by ID');
    }
  }

  /**
   * List all documents for a worker, ordered chronologically (newest first)
   */
  public async findByWorkerId(
    workerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerDocument[]> {
    try {
      const client = this.getClient(tx);
      return await client.workerDocument.findMany({
        where: { workerId },
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
      handleWorkerDbError(error, 'Failed to list worker documents');
    }
  }

  /**
   * Find latest document of each type for a worker
   */
  public async findLatestByWorker(
    workerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerDocument[]> {
    try {
      const all = await this.findByWorkerId(workerId, tx);
      const map = new Map<string, WorkerDocument>();
      for (const doc of all) {
        if (!map.has(doc.documentType)) {
          map.set(doc.documentType, doc);
        }
      }
      return Array.from(map.values());
    } catch (error) {
      handleWorkerDbError(error, 'Failed to list latest worker documents');
    }
  }

  /**
   * Find latest document for a worker by documentType
   */
  public async findLatestByType(
    workerId: bigint,
    documentType: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerDocument | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerDocument.findFirst({
        where: {
          workerId,
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
      handleWorkerDbError(error, 'Failed to find latest worker document by type');
    }
  }

  /**
   * Query documents pending administrative review with pagination
   */
  public async findPendingVerification(
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<WorkerDocument>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.WorkerDocumentWhereInput = {
        verificationStatus: 'PENDING',
      };

      const [items, total] = await Promise.all([
        client.workerDocument.findMany({
          where,
          skip,
          take: limit,
          orderBy: { uploadedAt: 'asc' }, // FIFO review queue
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
          },
        }),
        client.workerDocument.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to query pending verification worker documents');
    }
  }

  /**
   * Update document verification status and reviewer metadata
   */
  public async updateVerificationStatus(
    id: bigint,
    data: UpdateWorkerDocumentVerificationData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerDocument> {
    try {
      const client = this.getClient(tx);
      return await client.workerDocument.update({
        where: { id },
        data: {
          verificationStatus: data.verificationStatus,
          reviewedBy: data.reviewedBy ?? null,
          reviewedAt: data.reviewedAt ?? new Date(),
          rejectionReason: data.rejectionReason ?? null,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker document verification status');
    }
  }
}

export const workerDocumentRepository = new WorkerDocumentRepository();
