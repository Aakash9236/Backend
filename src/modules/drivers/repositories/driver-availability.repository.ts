import { Prisma, DriverAvailability } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  UpsertAvailabilityData,
  PaginationOptions,
  PaginatedResult,
} from '../drivers.types';
import { handleDriverDbError } from '../utils/driver-db-error.util';

export class DriverAvailabilityRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Find availability record by driver ID
   */
  public async findByDriverId(
    driverId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverAvailability | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverAvailability.findUnique({
        where: { driverId },
        include: {
          currentAssignment: {
            include: {
              vehicle: {
                select: {
                  id: true,
                  registrationNumber: true,
                  vehicleType: true,
                },
              },
            },
          },
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find driver availability');
    }
  }

  /**
   * Upsert availability record for driver
   */
  public async upsertAvailability(
    driverId: bigint,
    data: UpsertAvailabilityData,
    tx?: Prisma.TransactionClient
  ): Promise<DriverAvailability> {
    try {
      const client = this.getClient(tx);
      return await client.driverAvailability.upsert({
        where: { driverId },
        create: {
          driverId,
          isOnline: data.isOnline ?? false,
          isBusy: data.isBusy ?? false,
          currentAssignmentId: data.currentAssignmentId ?? null,
          lastHeartbeatAt: new Date(),
        },
        update: {
          ...(data.isOnline !== undefined ? { isOnline: data.isOnline } : {}),
          ...(data.isBusy !== undefined ? { isBusy: data.isBusy } : {}),
          ...(data.currentAssignmentId !== undefined
            ? { currentAssignmentId: data.currentAssignmentId }
            : {}),
          lastHeartbeatAt: new Date(),
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to upsert driver availability');
    }
  }

  /**
   * Update duty status (online/offline, busy/free)
   */
  public async updateDutyStatus(
    driverId: bigint,
    isOnline: boolean,
    isBusy: boolean = false,
    tx?: Prisma.TransactionClient
  ): Promise<DriverAvailability> {
    try {
      const client = this.getClient(tx);
      return await client.driverAvailability.upsert({
        where: { driverId },
        create: {
          driverId,
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
      handleDriverDbError(error, 'Failed to update driver duty status');
    }
  }

  /**
   * Update current assignment reference and busy state
   */
  public async updateCurrentAssignment(
    driverId: bigint,
    currentAssignmentId: bigint | null,
    isBusy: boolean = true,
    tx?: Prisma.TransactionClient
  ): Promise<DriverAvailability> {
    try {
      const client = this.getClient(tx);
      return await client.driverAvailability.upsert({
        where: { driverId },
        create: {
          driverId,
          isOnline: true,
          isBusy,
          currentAssignmentId,
          lastHeartbeatAt: new Date(),
        },
        update: {
          currentAssignmentId,
          isBusy,
          lastHeartbeatAt: new Date(),
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to update current assignment reference');
    }
  }

  /**
   * Update heartbeat timestamp
   */
  public async updateHeartbeat(
    driverId: bigint,
    heartbeatAt: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<DriverAvailability> {
    try {
      const client = this.getClient(tx);
      return await client.driverAvailability.upsert({
        where: { driverId },
        create: {
          driverId,
          isOnline: true,
          isBusy: false,
          lastHeartbeatAt: heartbeatAt,
        },
        update: {
          lastHeartbeatAt: heartbeatAt,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to update driver heartbeat');
    }
  }

  /**
   * Query drivers currently online and available
   */
  public async findOnlineDrivers(
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverAvailability>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.DriverAvailabilityWhereInput = {
        isOnline: true,
        driver: {
          approvalStatus: 'APPROVED',
          isActive: true,
        },
      };

      const [items, total] = await Promise.all([
        client.driverAvailability.findMany({
          where,
          skip,
          take: limit,
          orderBy: { lastHeartbeatAt: 'desc' },
          include: {
            driver: {
              include: {
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
        client.driverAvailability.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleDriverDbError(error, 'Failed to query online drivers');
    }
  }
}

export const driverAvailabilityRepository = new DriverAvailabilityRepository();

