import { Prisma, DriverInvitation } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateDriverInvitationData,
  UpdateInvitationStatusMetadata,
  PaginationOptions,
  PaginatedResult,
} from '../drivers.types';
import { handleDriverDbError } from '../utils/driver-db-error.util';

export class DriverInvitationRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Create a new driver invitation
   */
  public async create(
    data: CreateDriverInvitationData,
    tx?: Prisma.TransactionClient
  ): Promise<DriverInvitation> {
    try {
      const client = this.getClient(tx);
      return await client.driverInvitation.create({
        data: {
          partnerId: data.partnerId,
          invitedMobile: data.invitedMobile,
          driverName: data.driverName ?? null,
          driverUserId: data.driverUserId ?? null,
          invitationStatus: data.invitationStatus ?? 'PENDING',
          invitationToken: data.invitationToken,
          notes: data.notes ?? null,
          expiresAt: data.expiresAt,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to create driver invitation');
    }
  }

  /**
   * Find invitation by ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverInvitation | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverInvitation.findUnique({
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
          driverUser: {
            select: {
              id: true,
              mobileNumber: true,
              email: true,
            },
          },
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find driver invitation by ID');
    }
  }

  /**
   * Find invitation by token
   */
  public async findByToken(
    token: string,
    tx?: Prisma.TransactionClient
  ): Promise<DriverInvitation | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverInvitation.findUnique({
        where: { invitationToken: token },
        include: {
          partner: true,
          driverUser: true,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find driver invitation by token');
    }
  }

  /**
   * Find active PENDING invitation by partner ID and invited mobile
   */
  public async findPendingByPartnerAndMobile(
    partnerId: bigint,
    invitedMobile: string,
    tx?: Prisma.TransactionClient
  ): Promise<DriverInvitation | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverInvitation.findFirst({
        where: {
          partnerId,
          invitedMobile,
          invitationStatus: 'PENDING',
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find pending invitation by partner and mobile');
    }
  }

  /**
   * List invitations received for a driver mobile number (or user ID)
   */
  public async listReceivedForUser(
    invitedMobile: string,
    driverUserId?: bigint,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverInvitation>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.DriverInvitationWhereInput = {
        OR: [
          { invitedMobile },
          ...(driverUserId ? [{ driverUserId }] : []),
        ],
      };

      const orderBy: Prisma.DriverInvitationOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { createdAt: 'desc' };

      const [items, total] = await Promise.all([
        client.driverInvitation.findMany({
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
        client.driverInvitation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleDriverDbError(error, 'Failed to list received driver invitations');
    }
  }

  /**
   * List invitations created by a fleet partner
   */
  public async listCreatedByPartner(
    partnerId: bigint,
    status?: string,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverInvitation>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.DriverInvitationWhereInput = {
        partnerId,
        ...(status ? { invitationStatus: status } : {}),
      };

      const orderBy: Prisma.DriverInvitationOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { createdAt: 'desc' };

      const [items, total] = await Promise.all([
        client.driverInvitation.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            driverUser: {
              select: {
                id: true,
                mobileNumber: true,
                email: true,
              },
            },
          },
        }),
        client.driverInvitation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleDriverDbError(error, 'Failed to list partner driver invitations');
    }
  }

  /**
   * Update invitation status directly
   */
  public async updateStatus(
    id: bigint,
    status: string,
    metadata?: UpdateInvitationStatusMetadata,
    tx?: Prisma.TransactionClient
  ): Promise<DriverInvitation> {
    try {
      const client = this.getClient(tx);
      return await client.driverInvitation.update({
        where: { id },
        data: {
          invitationStatus: status,
          ...(metadata?.respondedAt !== undefined ? { respondedAt: metadata.respondedAt } : {}),
          ...(metadata?.rejectionReason !== undefined ? { rejectionReason: metadata.rejectionReason } : {}),
          ...(metadata?.revokedAt !== undefined ? { revokedAt: metadata.revokedAt } : {}),
          ...(metadata?.revokedBy !== undefined ? { revokedBy: metadata.revokedBy } : {}),
          ...(metadata?.driverUserId !== undefined ? { driverUserId: metadata.driverUserId } : {}),
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to update driver invitation status');
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
    metadata?: UpdateInvitationStatusMetadata,
    tx?: Prisma.TransactionClient
  ): Promise<DriverInvitation | null> {
    try {
      const client = this.getClient(tx);
      const updateResult = await client.driverInvitation.updateMany({
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
          ...(metadata?.driverUserId !== undefined ? { driverUserId: metadata.driverUserId } : {}),
        },
      });

      if (updateResult.count === 0) {
        return null;
      }

      return await this.findById(id, tx);
    } catch (error) {
      handleDriverDbError(error, 'Failed to conditionally transition driver invitation status');
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
      const result = await client.driverInvitation.updateMany({
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
      handleDriverDbError(error, 'Failed to batch expire eligible invitations');
    }
  }
}

export const driverInvitationRepository = new DriverInvitationRepository();

