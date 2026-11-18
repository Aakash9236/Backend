import { Prisma, DriverVehicleAssignment } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import {
  CreateAssignmentData,
  AssignmentFilter,
  PaginationOptions,
  PaginatedResult,
} from '../drivers.types';
import { handleDriverDbError } from '../utils/driver-db-error.util';

export class DriverVehicleAssignmentRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || prisma;
  }

  /**
   * Create a scheduled or active assignment.
   * NOTE: Database-level PostgreSQL GiST exclusion constraints are the final authority
   * enforcing zero overlapping shifts for driver and vehicle.
   */
  public async create(
    data: CreateAssignmentData,
    tx?: Prisma.TransactionClient
  ): Promise<DriverVehicleAssignment> {
    try {
      const client = this.getClient(tx);
      return await client.driverVehicleAssignment.create({
        data: {
          driverId: data.driverId,
          vehicleId: data.vehicleId,
          partnerId: data.partnerId,
          assignmentStatus: data.assignmentStatus ?? 'SCHEDULED',
          startTime: data.startTime,
          endTime: data.endTime ?? null,
          actualStartTime: data.actualStartTime ?? null,
          actualEndTime: data.actualEndTime ?? null,
          notes: data.notes ?? null,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to create driver vehicle assignment');
    }
  }

  /**
   * Find assignment by ID
   */
  public async findById(
    id: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverVehicleAssignment | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverVehicleAssignment.findUnique({
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
          vehicle: {
            include: {
              vehicleType: true,
            },
          },
          partner: {
            select: {
              id: true,
              legalName: true,
              businessName: true,
            },
          },
          canceller: {
            select: {
              id: true,
              mobileNumber: true,
              email: true,
            },
          },
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find driver vehicle assignment by ID');
    }
  }

  /**
   * Find current active ongoing assignment for a driver
   */
  public async findActiveByDriver(
    driverId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverVehicleAssignment | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverVehicleAssignment.findFirst({
        where: {
          driverId,
          assignmentStatus: 'ACTIVE',
        },
        include: {
          vehicle: {
            include: { vehicleType: true },
          },
          partner: true,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find active driver assignment');
    }
  }

  /**
   * Find current active ongoing assignment for a vehicle
   */
  public async findActiveByVehicle(
    vehicleId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<DriverVehicleAssignment | null> {
    try {
      const client = this.getClient(tx);
      return await client.driverVehicleAssignment.findFirst({
        where: {
          vehicleId,
          assignmentStatus: 'ACTIVE',
        },
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
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to find active vehicle assignment');
    }
  }

  /**
   * List assignments by driver
   */
  public async listByDriver(
    driverId: bigint,
    status?: string | string[],
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverVehicleAssignment>> {
    const statusArray = status ? (Array.isArray(status) ? status : [status]) : undefined;
    return this.queryAssignments({ driverId, assignmentStatus: statusArray }, options, tx);
  }

  /**
   * List assignments by vehicle
   */
  public async listByVehicle(
    vehicleId: bigint,
    status?: string | string[],
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverVehicleAssignment>> {
    const statusArray = status ? (Array.isArray(status) ? status : [status]) : undefined;
    return this.queryAssignments({ vehicleId, assignmentStatus: statusArray }, options, tx);
  }

  /**
   * List assignments by partner (fleet owner)
   */
  public async listByPartner(
    partnerId: bigint,
    status?: string | string[],
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverVehicleAssignment>> {
    const statusArray = status ? (Array.isArray(status) ? status : [status]) : undefined;
    return this.queryAssignments({ partnerId, assignmentStatus: statusArray }, options, tx);
  }

  /**
   * Generic paginated assignment query
   */
  public async queryAssignments(
    filter: AssignmentFilter,
    options?: PaginationOptions,
    tx?: Prisma.TransactionClient
  ): Promise<PaginatedResult<DriverVehicleAssignment>> {
    try {
      const client = this.getClient(tx);
      const page = Math.max(1, options?.page || 1);
      const limit = Math.max(1, Math.min(100, options?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.DriverVehicleAssignmentWhereInput = {
        ...(filter.driverId ? { driverId: filter.driverId } : {}),
        ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
        ...(filter.partnerId ? { partnerId: filter.partnerId } : {}),
        ...(filter.assignmentStatus
          ? Array.isArray(filter.assignmentStatus)
            ? { assignmentStatus: { in: filter.assignmentStatus } }
            : { assignmentStatus: filter.assignmentStatus }
          : {}),
        ...(filter.fromStartTime || filter.toStartTime
          ? {
              startTime: {
                ...(filter.fromStartTime ? { gte: filter.fromStartTime } : {}),
                ...(filter.toStartTime ? { lte: filter.toStartTime } : {}),
              },
            }
          : {}),
      };

      const orderBy: Prisma.DriverVehicleAssignmentOrderByWithRelationInput = options?.sortBy
        ? { [options.sortBy]: options.sortOrder || 'desc' }
        : { startTime: 'desc' };

      const [items, total] = await Promise.all([
        client.driverVehicleAssignment.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            driver: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                licenceNumber: true,
                user: {
                  select: { id: true, mobileNumber: true },
                },
              },
            },
            vehicle: {
              select: {
                id: true,
                registrationNumber: true,
                vehicleType: {
                  select: { id: true, typeCode: true, typeName: true },
                },
              },
            },
            partner: {
              select: { id: true, legalName: true, businessName: true },
            },
          },
        }),
        client.driverVehicleAssignment.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (error) {
      handleDriverDbError(error, 'Failed to query driver vehicle assignments');
    }
  }

  /**
   * Pre-check potential overlap in query (advisory fast path; PostgreSQL GiST exclusion is authoritative)
   */
  public async checkPotentialOverlap(
    params: {
      driverId?: bigint;
      vehicleId?: bigint;
      startTime: Date;
      endTime?: Date | null;
      excludeAssignmentId?: bigint;
    },
    tx?: Prisma.TransactionClient
  ): Promise<{ hasDriverOverlap: boolean; hasVehicleOverlap: boolean }> {
    try {
      const client = this.getClient(tx);
      const effectiveEnd = params.endTime || new Date('9999-12-31T23:59:59Z');

      let hasDriverOverlap = false;
      let hasVehicleOverlap = false;

      if (params.driverId) {
        const driverOverlapCount = await client.driverVehicleAssignment.count({
          where: {
            driverId: params.driverId,
            assignmentStatus: { in: ['SCHEDULED', 'ACTIVE'] },
            ...(params.excludeAssignmentId ? { id: { not: params.excludeAssignmentId } } : {}),
            startTime: { lt: effectiveEnd },
            OR: [
              { endTime: null },
              { endTime: { gt: params.startTime } },
            ],
          },
        });
        hasDriverOverlap = driverOverlapCount > 0;
      }

      if (params.vehicleId) {
        const vehicleOverlapCount = await client.driverVehicleAssignment.count({
          where: {
            vehicleId: params.vehicleId,
            assignmentStatus: { in: ['SCHEDULED', 'ACTIVE'] },
            ...(params.excludeAssignmentId ? { id: { not: params.excludeAssignmentId } } : {}),
            startTime: { lt: effectiveEnd },
            OR: [
              { endTime: null },
              { endTime: { gt: params.startTime } },
            ],
          },
        });
        hasVehicleOverlap = vehicleOverlapCount > 0;
      }

      return { hasDriverOverlap, hasVehicleOverlap };
    } catch (error) {
      handleDriverDbError(error, 'Failed to check potential overlap');
    }
  }

  /**
   * Start assignment (transition SCHEDULED -> ACTIVE)
   */
  public async startAssignment(
    id: bigint,
    actualStartTime: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<DriverVehicleAssignment> {
    try {
      const client = this.getClient(tx);
      return await client.driverVehicleAssignment.update({
        where: { id },
        data: {
          assignmentStatus: 'ACTIVE',
          actualStartTime,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to start driver vehicle assignment');
    }
  }

  /**
   * Complete assignment (transition ACTIVE -> COMPLETED)
   */
  public async completeAssignment(
    id: bigint,
    actualEndTime: Date = new Date(),
    notes?: string,
    tx?: Prisma.TransactionClient
  ): Promise<DriverVehicleAssignment> {
    try {
      const client = this.getClient(tx);
      return await client.driverVehicleAssignment.update({
        where: { id },
        data: {
          assignmentStatus: 'COMPLETED',
          actualEndTime,
          ...(notes ? { notes } : {}),
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to complete driver vehicle assignment');
    }
  }

  /**
   * Cancel assignment (transition SCHEDULED/ACTIVE -> CANCELLED)
   */
  public async cancelAssignment(
    id: bigint,
    cancelledBy: bigint,
    cancellationReason: string,
    cancelledAt: Date = new Date(),
    tx?: Prisma.TransactionClient
  ): Promise<DriverVehicleAssignment> {
    try {
      const client = this.getClient(tx);
      return await client.driverVehicleAssignment.update({
        where: { id },
        data: {
          assignmentStatus: 'CANCELLED',
          cancelledBy,
          cancellationReason,
          cancelledAt,
        },
      });
    } catch (error) {
      handleDriverDbError(error, 'Failed to cancel driver vehicle assignment');
    }
  }
}

export const driverVehicleAssignmentRepository = new DriverVehicleAssignmentRepository();

