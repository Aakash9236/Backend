import { Prisma, WorkerPartnerAffiliation } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateWorkerAffiliationData,
  PaginationOptions,
  PaginatedResult,
} from '../workers.types';
import { handleWorkerDbError } from '../utils/worker-db-error.util';

export class WorkerPartnerAffiliationRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Create an affiliation record.
   */
  public async create(
    data: CreateWorkerAffiliationData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerPartnerAffiliation> {
    try {
      const client = this.getClient(tx);
      return await client.workerPartnerAffiliation.create({
        data: {
          workerId: data.workerId,
          partnerId: data.partnerId,
          invitationId: data.invitationId ?? null,
          affiliationStatus: data.affiliationStatus ?? 'ACTIVE',
          consentGivenAt: data.consentGivenAt ?? new Date(),
          affiliatedAt: data.affiliatedAt ?? new Date(),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to create worker-partner affiliation');
    }
  }

  /**
   * Find affiliation by primary key ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerPartnerAffiliation | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerPartnerAffiliation.findUnique({
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
          partner: true,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find worker affiliation by ID');
    }
  }

  /**
   * Find active affiliation between worker and partner
   */
  public async findActive(
    workerId: bigint,
    partnerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerPartnerAffiliation | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerPartnerAffiliation.findFirst({
        where: {
          workerId,
          partnerId,
          affiliationStatus: 'ACTIVE',
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find active affiliation between worker and partner');
    }
  }

  /**
   * List all active affiliations for a given worker (supports multiple service partners)
   */
  public async listActiveByWorker(
    workerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerPartnerAffiliation[]> {
    try {
      const client = this.getClient(tx);
      return await client.workerPartnerAffiliation.findMany({
        where: {
          workerId,
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
      handleWorkerDbError(error, 'Failed to list active worker affiliations');
    }
  }

  /**
   * List all affiliations (active or past) for a given worker
   */
  public async listByWorker(
    workerId: bigint,
    status?: string,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<WorkerPartnerAffiliation>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.WorkerPartnerAffiliationWhereInput = {
        workerId,
        ...(status ? { affiliationStatus: status } : {}),
      };

      const orderBy: Prisma.WorkerPartnerAffiliationOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { affiliatedAt: 'desc' };

      const [items, total] = await Promise.all([
        client.workerPartnerAffiliation.findMany({
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
        client.workerPartnerAffiliation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to list worker affiliations');
    }
  }

  /**
   * List all active workers affiliated with a partner
   */
  public async listActiveByPartner(
    partnerId: bigint,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<WorkerPartnerAffiliation>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.WorkerPartnerAffiliationWhereInput = {
        partnerId,
        affiliationStatus: 'ACTIVE',
      };

      const orderBy: Prisma.WorkerPartnerAffiliationOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { affiliatedAt: 'desc' };

      const [items, total] = await Promise.all([
        client.workerPartnerAffiliation.findMany({
          where,
          skip,
          take: limit,
          orderBy,
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
          },
        }),
        client.workerPartnerAffiliation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to list active partner affiliations');
    }
  }

  /**
   * List workers affiliated with a partner (with optional status filter)
   */
  public async listByPartner(
    partnerId: bigint,
    status?: string,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<WorkerPartnerAffiliation>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.WorkerPartnerAffiliationWhereInput = {
        partnerId,
        ...(status ? { affiliationStatus: status } : {}),
      };

      const orderBy: Prisma.WorkerPartnerAffiliationOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { affiliatedAt: 'desc' };

      const [items, total] = await Promise.all([
        client.workerPartnerAffiliation.findMany({
          where,
          skip,
          take: limit,
          orderBy,
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
          },
        }),
        client.workerPartnerAffiliation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleWorkerDbError(error, 'Failed to list partner worker affiliations');
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
  ): Promise<WorkerPartnerAffiliation> {
    try {
      const client = this.getClient(tx);
      return await client.workerPartnerAffiliation.update({
        where: { id },
        data: {
          affiliationStatus: 'TERMINATED',
          terminatedAt,
          terminationReason: terminationReason ?? null,
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to terminate worker affiliation');
    }
  }
}

export const workerPartnerAffiliationRepository = new WorkerPartnerAffiliationRepository();
