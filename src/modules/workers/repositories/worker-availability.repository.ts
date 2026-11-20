import { Prisma, WorkerAvailability } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  UpsertWorkerAvailabilityData,
} from '../workers.types';
import { handleWorkerDbError } from '../utils/worker-db-error.util';

export class WorkerAvailabilityRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Find availability record by worker ID
   */
  public async findByWorkerId(
    workerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerAvailability | null> {
    try {
      const client = this.getClient(tx);
      return await client.workerAvailability.findUnique({
        where: { workerId },
        include: {
          worker: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              workerType: true,
              approvalStatus: true,
              isActive: true,
            },
          },
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find worker availability');
    }
  }

  /**
   * Upsert availability record for worker
   */
  public async upsertAvailability(
    workerId: bigint,
    data: UpsertWorkerAvailabilityData,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerAvailability> {
    try {
      const client = this.getClient(tx);
      return await client.workerAvailability.upsert({
        where: { workerId },
        create: {
          workerId,
          isOnline: data.isOnline ?? false,
          isBusy: data.isBusy ?? false,
          currentLatitude: data.currentLatitude !== undefined && data.currentLatitude !== null ? new Prisma.Decimal(data.currentLatitude.toString()) : null,
          currentLongitude: data.currentLongitude !== undefined && data.currentLongitude !== null ? new Prisma.Decimal(data.currentLongitude.toString()) : null,
          lastHeartbeatAt: data.lastHeartbeatAt ?? new Date(),
        },
        update: {
          ...(data.isOnline !== undefined ? { isOnline: data.isOnline } : {}),
          ...(data.isBusy !== undefined ? { isBusy: data.isBusy } : {}),
          ...(data.currentLatitude !== undefined
            ? {
                currentLatitude: data.currentLatitude !== null ? new Prisma.Decimal(data.currentLatitude.toString()) : null,
              }
            : {}),
          ...(data.currentLongitude !== undefined
            ? {
                currentLongitude: data.currentLongitude !== null ? new Prisma.Decimal(data.currentLongitude.toString()) : null,
              }
            : {}),
          lastHeartbeatAt: data.lastHeartbeatAt ?? new Date(),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to upsert worker availability');
    }
  }

  /**
   * Update duty status (online/offline, busy/free)
   */
  public async updateDutyStatus(
    workerId: bigint,
    isOnline: boolean,
    isBusy: boolean = false,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerAvailability> {
    try {
      const client = this.getClient(tx);
      return await client.workerAvailability.upsert({
        where: { workerId },
        create: {
          workerId,
          isOnline,
          isBusy,
          lastHeartbeatAt: new Date(),
        },
        update: {
          isOnline,
          isBusy,
          lastHeartbeatAt: new Date(),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker duty status');
    }
  }

  /**
   * Update heartbeat timestamp and optional coordinates without automatically marking offline worker online
   */
  public async updateHeartbeat(
    workerId: bigint,
    latitude?: number | Prisma.Decimal | null,
    longitude?: number | Prisma.Decimal | null,
    tx?: Prisma.TransactionClient
  ): Promise<WorkerAvailability> {
    try {
      const client = this.getClient(tx);
      return await client.workerAvailability.upsert({
        where: { workerId },
        create: {
          workerId,
          isOnline: false, // Never silently reactivate an offline worker through heartbeat
          isBusy: false,
          currentLatitude: latitude !== undefined && latitude !== null ? new Prisma.Decimal(latitude.toString()) : null,
          currentLongitude: longitude !== undefined && longitude !== null ? new Prisma.Decimal(longitude.toString()) : null,
          lastHeartbeatAt: new Date(),
        },
        update: {
          lastHeartbeatAt: new Date(),
          ...(latitude !== undefined
            ? {
                currentLatitude: latitude !== null ? new Prisma.Decimal(latitude.toString()) : null,
              }
            : {}),
          ...(longitude !== undefined
            ? {
                currentLongitude: longitude !== null ? new Prisma.Decimal(longitude.toString()) : null,
              }
            : {}),
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to update worker heartbeat');
    }
  }

  /**
   * Atomically acquire a dispatch lock on an online, non-busy worker
   */
  public async atomicAcquireLock(
    workerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<boolean> {
    try {
      const client = this.getClient(tx);
      const result = await client.workerAvailability.updateMany({
        where: {
          workerId,
          isOnline: true,
          isBusy: false,
        },
        data: {
          isBusy: true,
          lastHeartbeatAt: new Date(),
        },
      });
      return result.count > 0;
    } catch (error) {
      handleWorkerDbError(error, 'Failed to atomically acquire dispatch lock on worker');
    }
  }

  /**
   * Atomically release a dispatch lock on a worker
   */
  public async atomicReleaseLock(
    workerId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<boolean> {
    try {
      const client = this.getClient(tx);
      const result = await client.workerAvailability.updateMany({
        where: {
          workerId,
          isBusy: true,
        },
        data: {
          isBusy: false,
          lastHeartbeatAt: new Date(),
        },
      });
      return result.count > 0;
    } catch (error) {
      handleWorkerDbError(error, 'Failed to atomically release dispatch lock on worker');
    }
  }

  /**
   * Find all online and free workers
   */
  public async findOnlineAvailable(
    tx?: Prisma.TransactionClient
  ): Promise<WorkerAvailability[]> {
    try {
      const client = this.getClient(tx);
      return await client.workerAvailability.findMany({
        where: {
          isOnline: true,
          isBusy: false,
        },
        include: {
          worker: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              workerType: true,
              approvalStatus: true,
              isActive: true,
            },
          },
        },
      });
    } catch (error) {
      handleWorkerDbError(error, 'Failed to find online available workers');
    }
  }
}

export const workerAvailabilityRepository = new WorkerAvailabilityRepository();
