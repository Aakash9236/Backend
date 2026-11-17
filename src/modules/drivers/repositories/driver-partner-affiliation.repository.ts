import { Prisma, DriverPartnerAffiliation } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateAffiliationData,
  PaginationOptions,
  PaginatedResult,
} from '../drivers.types';
import { handleDriverDbError } from '../utils/driver-db-error.util';

export class DriverPartnerAffiliationRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Create an affiliation record.
   */
  public async create(
    data: CreateAffiliationData,
    tx?: Prisma.TransactionClient
  ): Promise<DriverPartnerAffiliation> {
    try {
      const client = this.getClient(tx);
      return await client.driverPartnerAffiliation.create({
        data: {
          driverId: data.driverId,
          partnerId: data.partnerId,
          invitationId: data.invitationId ?? null,
          affiliationStatus: data.affiliationStatus ?? 'ACTIVE',
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to create driver-partner affiliation');
    }
  }

  /**
   * Find affiliation by primary key ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverPartnerAffiliation | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverPartnerAffiliation.findUnique({
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
          partner: true,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find affiliation by ID');
    }
  }

  /**
   * Find active affiliation between driver and partner
   */
  public async findActive(
    driverId: bigint,
    partnerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverPartnerAffiliation | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverPartnerAffiliation.findFirst({
        where: {
          driverId,
          partnerId,
          affiliationStatus: 'ACTIVE',
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find active affiliation between driver and partner');
    }
  }

  /**
   * List all active affiliations for a given driver (supports multiple fleet owners)
   */
  public async listActiveByDriver(
    driverId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverPartnerAffiliation[]> {
    try {
      const client = this.getClient(tx);
      return await client.driverPartnerAffiliation.findMany({
        where: {
          driverId,
          affiliationStatus: 'ACTIVE',
        },
        orderBy: { affiliatedAt: 'desc' },
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
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to list active driver affiliations');
    }
  }

  /**
   * List all active drivers affiliated with a fleet partner
   */
  public async listActiveByPartner(
    partnerId: bigint,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverPartnerAffiliation>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.DriverPartnerAffiliationWhereInput = {
        partnerId,
        affiliationStatus: 'ACTIVE',
      };

      const orderBy: Prisma.DriverPartnerAffiliationOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { affiliatedAt: 'desc' };

      const [items, total] = await Promise.all([
        client.driverPartnerAffiliation.findMany({
          where,
          skip,
          take: limit,
          orderBy,
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
          },
        }),
        client.driverPartnerAffiliation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleDriverDbError(error, 'Failed to list active partner affiliations');
    }
  }

  /**
   * Terminate an affiliation (preserves historical record)
   */
  public async terminate(
    id: bigint,
    terminationReason?: string | null,
    terminatedAt: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<DriverPartnerAffiliation> {
    try {
      const client = this.getClient(tx);
      return await client.driverPartnerAffiliation.update({
        where: { id },
        data: {
          affiliationStatus: 'TERMINATED',
          terminatedAt,
          terminationReason: terminationReason ?? null,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to terminate affiliation');
    }
  }

  /**
   * List complete affiliation history between a driver and partner (or all for a driver)
   */
  public async listHistory(
    driverId: bigint,
    partnerId?: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverPartnerAffiliation[]> {
    try {
      const client = this.getClient(tx);
      return await client.driverPartnerAffiliation.findMany({
        where: {
          driverId,
          ...(partnerId ? { partnerId } : {}),
        },
        orderBy: { affiliatedAt: 'desc' },
        include: {
          partner: {
            select: {
              id: true,
              legalName: true,
              businessName: true,
            },
          },
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to list affiliation history');
    }
  }
}

export const driverPartnerAffiliationRepository = new DriverPartnerAffiliationRepository();

