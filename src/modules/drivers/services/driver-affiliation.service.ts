import { DriverPartnerAffiliation } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../../common/errors';
import { DriverPartnerAffiliationRepository } from '../repositories/driver-partner-affiliation.repository';
import { DriverProfileRepository } from '../repositories/driver-profile.repository';
import { DriverVehicleAssignmentRepository } from '../repositories/driver-vehicle-assignment.repository';
import { PaginationOptions, PaginatedResult } from '../drivers.types';

// ============================================================================
// Types & DTOs
// ============================================================================

export interface DriverAffiliationResponse {
  id: string;
  driverId: string;
  driverName?: string;
  driverMobile?: string;
  partnerId: string;
  partnerBusinessName?: string;
  partnerMobile?: string;
  invitationId: string | null;
  affiliationStatus: string;
  affiliatedAt: string;
  terminatedAt: string | null;
  terminationReason: string | null;
}

// ============================================================================
// Driver Affiliation Service
// ============================================================================

export class DriverAffiliationService {
  constructor(
    private affiliationRepo: DriverPartnerAffiliationRepository = new DriverPartnerAffiliationRepository(),
    private profileRepo: DriverProfileRepository = new DriverProfileRepository(),
    private assignmentRepo: DriverVehicleAssignmentRepository = new DriverVehicleAssignmentRepository()
  ) {}

  /**
   * Serializes a DriverPartnerAffiliation record into an API-safe response.
   */
  private serializeAffiliation(affiliation: any): DriverAffiliationResponse {
    return {
      id: affiliation.id.toString(),
      driverId: affiliation.driverId.toString(),
      driverName: affiliation.driver ? `${affiliation.driver.firstName} ${affiliation.driver.lastName || ''}`.trim() : undefined,
      driverMobile: affiliation.driver?.user?.mobileNumber,
      partnerId: affiliation.partnerId.toString(),
      partnerBusinessName: affiliation.partner?.businessName,
      partnerMobile: affiliation.partner?.user?.mobileNumber,
      invitationId: affiliation.invitationId ? affiliation.invitationId.toString() : null,
      affiliationStatus: affiliation.affiliationStatus,
      affiliatedAt: affiliation.affiliatedAt.toISOString(),
      terminatedAt: affiliation.terminatedAt ? affiliation.terminatedAt.toISOString() : null,
      terminationReason: affiliation.terminationReason,
    };
  }

  /**
   * Lists all active or historical affiliations for the authenticated driver.
   * Supports drivers affiliated with multiple fleet partners without artificial limit.
   */
  public async listDriverAffiliations(
    driverUserIdInput: bigint | string,
    options?: { status?: string }
  ): Promise<DriverAffiliationResponse[]> {
    const driverUserId = BigInt(driverUserIdInput);
    const profile = await this.profileRepo.findByUserId(driverUserId);

    if (!profile) {
      throw new NotFoundError('Driver profile not found.');
    }

    if (options?.status === 'ACTIVE' || !options?.status) {
      const activeAffiliations = await this.affiliationRepo.listActiveByDriver(profile.id);
      return activeAffiliations.map((a: DriverPartnerAffiliation) => this.serializeAffiliation(a));
    }

    // Historical listing
    const history = await this.affiliationRepo.listHistory(profile.id, undefined);
    return history.map((a: DriverPartnerAffiliation) => this.serializeAffiliation(a));
  }

  /**
   * Lists all drivers affiliated with the authenticated partner's fleet.
   */
  public async listPartnerAffiliations(
    partnerUserIdInput: bigint | string,
    options?: { status?: string }
  ): Promise<DriverAffiliationResponse[]> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    if (options?.status === 'ACTIVE' || !options?.status) {
      const activeAffiliations = await this.affiliationRepo.listActiveByPartner(partner.id);
      return activeAffiliations.items.map((a: DriverPartnerAffiliation) => this.serializeAffiliation(a));
    }

    // Historical listing
    const history = await prisma.driverPartnerAffiliation.findMany({
      where: {
        partnerId: partner.id,
        ...(options?.status ? { affiliationStatus: options.status } : {}),
      },
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
      orderBy: { affiliatedAt: 'desc' },
    });
    return history.map((a: any) => this.serializeAffiliation(a));
  }

  /**
   * Retrieves an affiliation by ID with cross-tenant authorization checks.
   * Access is strictly restricted to the affiliated driver or the affiliated partner owner.
   */
  public async getAffiliationById(
    userIdInput: bigint | string,
    affiliationIdInput: bigint | string
  ): Promise<DriverAffiliationResponse> {
    const userId = BigInt(userIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Affiliation with ID ${affiliationId.toString()} not found.`);
    }

    // Check authorization: caller must be either the affiliated driver user or the affiliated partner user
    const driver = await this.profileRepo.findById(affiliation.driverId);
    const partner = await prisma.partnerProfile.findUnique({
      where: { id: affiliation.partnerId },
    });

    const isAffiliatedDriver = driver?.userId === userId;
    const isAffiliatedPartner = partner?.userId === userId;

    if (!isAffiliatedDriver && !isAffiliatedPartner) {
      throw new ForbiddenError('You do not have permission to view this affiliation record.');
    }

    return this.serializeAffiliation(affiliation);
  }

  /**
   * Terminate an affiliation by the fleet partner owner.
   *
   * Business Rules:
   * 1. Partner must own the affiliation.
   * 2. Cannot terminate while driver is currently executing an ACTIVE shift with this partner.
   * 3. Any upcoming SCHEDULED shifts for this driver with this partner are automatically cancelled.
   * 4. Updates affiliation status to 'TERMINATED' and records reason & timestamp (history preserved).
   */
  public async terminateAffiliationByPartner(
    partnerUserIdInput: bigint | string,
    affiliationIdInput: bigint | string,
    reason?: string
  ): Promise<DriverAffiliationResponse> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.partnerId !== partner.id) {
      throw new ForbiddenError('You cannot terminate an affiliation belonging to another partner fleet.');
    }

    if (affiliation.affiliationStatus === 'TERMINATED') {
      throw new ConflictError('This affiliation has already been terminated.');
    }

    // 1. Guard: Check for active shifts with this partner
    const activeShift = await prisma.driverVehicleAssignment.findFirst({
      where: {
        driverId: affiliation.driverId,
        partnerId: partner.id,
        assignmentStatus: 'ACTIVE',
      },
    });

    if (activeShift) {
      throw new ConflictError(
        'Cannot terminate affiliation while the driver has an active shift with your fleet. Please complete or cancel the active shift first.'
      );
    }

    // 2. Atomic termination & cancellation of upcoming scheduled shifts
    const terminated = await prisma.$transaction(async (tx) => {
      // Cancel upcoming scheduled shifts with this partner
      const scheduledAssignments = await tx.driverVehicleAssignment.findMany({
        where: {
          driverId: affiliation.driverId,
          partnerId: partner.id,
          assignmentStatus: 'SCHEDULED',
        },
      });

      for (const assignment of scheduledAssignments) {
        await this.assignmentRepo.cancelAssignment(
          assignment.id,
          partnerUserId,
          'Affiliation terminated by fleet partner',
          new Date(),
          tx
        );
      }

      // Terminate affiliation
      return await this.affiliationRepo.terminate(
        affiliationId,
        reason ? reason.trim() : 'Terminated by fleet partner',
        new Date(),
        tx
      );
    });

    logger.info(
      `[Driver Affiliation] Partner ${partner.id.toString()} terminated affiliation ${affiliationId.toString()} with Driver ${affiliation.driverId.toString()}`
    );

    return this.serializeAffiliation(terminated);
  }

  /**
   * Terminate an affiliation by the driver.
   *
   * Business Rules:
   * 1. Driver must own the affiliation.
   * 2. Cannot terminate during an ACTIVE shift with this partner.
   * 3. Any upcoming SCHEDULED shifts with this partner are automatically cancelled.
   * 4. Updates affiliation status to 'TERMINATED' and records reason & timestamp.
   */
  public async terminateAffiliationByDriver(
    driverUserIdInput: bigint | string,
    affiliationIdInput: bigint | string,
    reason?: string
  ): Promise<DriverAffiliationResponse> {
    const driverUserId = BigInt(driverUserIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    const profile = await this.profileRepo.findByUserId(driverUserId);
    if (!profile) {
      throw new NotFoundError('Driver profile not found.');
    }

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.driverId !== profile.id) {
      throw new ForbiddenError('You do not have permission to terminate an affiliation that is not yours.');
    }

    if (affiliation.affiliationStatus === 'TERMINATED') {
      throw new ConflictError('This affiliation has already been terminated.');
    }

    // 1. Guard: Check for active shifts
    const activeShift = await prisma.driverVehicleAssignment.findFirst({
      where: {
        driverId: profile.id,
        partnerId: affiliation.partnerId,
        assignmentStatus: 'ACTIVE',
      },
    });

    if (activeShift) {
      throw new ConflictError(
        'Cannot terminate affiliation during an active shift. Please complete your shift before disaffiliating.'
      );
    }

    // 2. Atomic termination & cancellation of upcoming scheduled shifts
    const terminated = await prisma.$transaction(async (tx) => {
      // Cancel upcoming scheduled shifts with this partner
      const scheduledAssignments = await tx.driverVehicleAssignment.findMany({
        where: {
          driverId: profile.id,
          partnerId: affiliation.partnerId,
          assignmentStatus: 'SCHEDULED',
        },
      });

      for (const assignment of scheduledAssignments) {
        await this.assignmentRepo.cancelAssignment(
          assignment.id,
          driverUserId,
          'Affiliation terminated by driver',
          new Date(),
          tx
        );
      }

      // Terminate affiliation
      return await this.affiliationRepo.terminate(
        affiliationId,
        reason ? reason.trim() : 'Voluntarily disaffiliated by driver',
        new Date(),
        tx
      );
    });

    logger.info(
      `[Driver Affiliation] Driver ${profile.id.toString()} terminated affiliation ${affiliationId.toString()} with Partner ${affiliation.partnerId.toString()}`
    );

    return this.serializeAffiliation(terminated);
  }
}

export const driverAffiliationService = new DriverAffiliationService();
