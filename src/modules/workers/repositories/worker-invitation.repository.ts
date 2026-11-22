import crypto from 'crypto';
import { Prisma, WorkerInvitation } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateWorkerInvitationData,
  UpdateWorkerInvitationStatusMetadata,
  PaginationOptions,
  PaginatedResult,
} from '../workers.types';
import { handleWorkerDbError } from '../utils/worker-db-error.util';

export class WorkerInvitationRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Create a new worker invitation
   */
  public async create(
    data: CreateWorkerInvitationData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerInvitation> {
    try {
      const client = this.getClient(tx);
      return await client.workerInvitation.create({
        data: {
          partnerId: data.partnerId,
          invitingUserId: data.invitingUserId ?? null,
          invitedMobile: data.invitedMobile,
          workerName: data.workerName ?? null,
          workerUserId: data.workerUserId ?? null,
          invitationStatus: data.invitationStatus ?? 'PENDING',
          invitationTokenHash: data.invitationTokenHash,
          proposedRole: data.proposedRole ?? null,
          notes: data.notes ?? null,
          expiresAt: data.expiresAt,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to create worker invitation');
    }
  }

  /**
   * Find invitation by ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerInvitation | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerInvitation.findUnique({
        where: { id },
        include: {
          partner: {
            select: {
              id: true,
              legalName: true,
              businessName: true,
              profileType: true,
            },
          },
          invitingUser: {
            select: {
              id: true,
              mobileNumber: true,
              email: true,
            },
          },
          workerUser: {
            select: {
              id: true,
              mobileNumber: true,
              email: true,
            },
          },
          revoker: {
            select: {
              id: true,
              mobileNumber: true,
              email: true,
            },
          },
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find worker invitation by ID');
    }
  }

  /**
   * Find invitation by cryptographic token hash
   */
  public async findByTokenHash(
    tokenHash: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerInvitation | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerInvitation.findUnique({
        where: { invitationTokenHash: tokenHash },
        include: {
          partner: true,
          workerUser: true,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find worker invitation by token hash');
    }
  }

  /**
   * Find invitation by raw unhashed token (hashes to SHA-256 before querying)
   */
  public async findByToken(
    rawToken: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerInvitation | null> {
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    return this.findByTokenHash(tokenHash, tx);
  }

  /**
   * Find active PENDING invitation by partner ID and invited mobile
   */
  public async findPendingByPartnerAndMobile(
    partnerId: bigint,
    invitedMobile: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerInvitation | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerInvitation.findFirst({
        where: {
          partnerId,
          invitedMobile,
          invitationStatus: 'PENDING',
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find pending invitation by partner and mobile');
    }
  }

  /**
   * List invitations received for a worker mobile number (or user ID)
   */
  public async listReceivedForMobile(
    invitedMobile: string,
    workerUserId?: bigint,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<WorkerInvitation>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.WorkerInvitationWhereInput = {
        OR: [
          { invitedMobile },
          ...(workerUserId ? [{ workerUserId }] : []),
        ],
      };

      const orderBy: Prisma.WorkerInvitationOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { createdAt: 'desc' };

      const [items, total] = await Promise.all([
        client.workerInvitation.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            partner: {
              select: {
                id: true,
                legalName: true,
                businessName: true,
                profileType: true,
              },
            },
          },
        }),
        client.workerInvitation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to list received worker invitations');
    }
  }

  /**
   * List invitations created by a service partner
   */
  public async listCreatedByPartner(
    partnerId: bigint,
    status?: string,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<WorkerInvitation>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.WorkerInvitationWhereInput = {
        partnerId,
        ...(status ? { invitationStatus: status } : {}),
      };

      const orderBy: Prisma.WorkerInvitationOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { createdAt: 'desc' };

      const [items, total] = await Promise.all([
        client.workerInvitation.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            workerUser: {
              select: {
                id: true,
                mobileNumber: true,
                email: true,
              },
            },
          },
        }),
        client.workerInvitation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to list partner worker invitations');
    }
  }

  /**
   * Update invitation status directly
   */
  public async updateStatus(
    id: bigint,
    status: string,
    metadata?: UpdateWorkerInvitationStatusMetadata,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerInvitation> {
    try {
      const client = this.getClient(tx);
      return await client.workerInvitation.update({
        where: { id },
        data: {
          invitationStatus: status,
          ...(metadata?.respondedAt !== undefined ? { respondedAt: metadata.respondedAt } : {}),
          ...(metadata?.rejectionReason !== undefined ? { rejectionReason: metadata.rejectionReason } : {}),
          ...(metadata?.revokedAt !== undefined ? { revokedAt: metadata.revokedAt } : {}),
          ...(metadata?.revokedBy !== undefined ? { revokedBy: metadata.revokedBy } : {}),
          ...(metadata?.workerUserId !== undefined ? { workerUserId: metadata.workerUserId } : {}),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker invitation status');
    }
  }

  /**
   * Increment resend counter
   */
  public async incrementResendCount(
    id: bigint,
    newExpiresAt?: Date,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerInvitation> {
    try {
      const client = this.getClient(tx);
      return await client.workerInvitation.update({
        where: { id },
        data: {
          resendCount: { increment: 1 },
          ...(newExpiresAt ? { expiresAt: newExpiresAt } : {}),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to increment worker invitation resend count');
    }
  }

  /**
   * Conditional atomic state transition:
   * Transitions from `fromStatus` to `toStatus` only if current status equals `fromStatus`.
   * Returns updated record if transition succeeded, or null if condition failed (e.g. race condition).
   */
  public async atomicTransitionStatus(
    id: bigint,
    fromStatus: string,
    toStatus: string,
    metadata?: UpdateWorkerInvitationStatusMetadata,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerInvitation | null> {
    try {
      const client = this.getClient(tx);
      const updateResult = await client.workerInvitation.updateMany({
        where: {
          id,
          invitationStatus: fromStatus,
        },
        data: {
          invitationStatus: toStatus,
          ...(metadata?.respondedAt !== undefined ? { respondedAt: metadata.respondedAt } : {}),
          ...(metadata?.rejectionReason !== undefined ? { rejectionReason: metadata.rejectionReason } : {}),
          ...(metadata?.revokedAt !== undefined ? { revokedAt: metadata.revokedAt } : {}),
          ...(metadata?.revokedBy !== undefined ? { revokedBy: metadata.revokedBy } : {}),
          ...(metadata?.workerUserId !== undefined ? { workerUserId: metadata.workerUserId } : {}),
        },
      });

      if (updateResult.count === 0) {
        return null;
      }

      return await this.findById(id, tx);
    } catch (error) {
      handleWorkerDbError(error, 'Failed to conditionally transition worker invitation status');
    }
  }

  /**
   * Batch expire all pending invitations whose expires_at is before reference time (defaults to now)
   */
  public async expireEligibleInvitations(
    now: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    try {
      const client = this.getClient(tx);
      const result = await client.workerInvitation.updateMany({
        where: {
          invitationStatus: 'PENDING',
          expiresAt: { lt: now },
        },
        data: {
          invitationStatus: 'EXPIRED',
        },
      });
      return result.count;
    } catch (error) {
      handleWorkerDbError(error, 'Failed to batch expire eligible worker invitations');
    }
  }
}

export const workerInvitationRepository = new WorkerInvitationRepository();
