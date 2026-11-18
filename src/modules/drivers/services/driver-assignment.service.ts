import { Prisma, DriverVehicleAssignment } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from '../../../common/errors';
import { DateUtil } from '../../../common/utils/date.util';
import { DriverVehicleAssignmentRepository } from '../repositories/driver-vehicle-assignment.repository';
import { DriverAvailabilityRepository } from '../repositories/driver-availability.repository';
import { DriverProfileRepository } from '../repositories/driver-profile.repository';
import { DriverPartnerAffiliationRepository } from '../repositories/driver-partner-affiliation.repository';
import { VehicleRepository, vehicleRepository } from '../../vehicles/vehicles.repository';
import {
  DriverKycValidationService,
  driverKycValidationService,
} from './driver-kyc.service';
import { PaginationOptions, PaginatedResult } from '../drivers.types';

// ============================================================================
// Types & DTOs
// ============================================================================

export interface ScheduleAssignmentInput {
  driverId: bigint | string;
  vehicleId: bigint | string;
  startTime: Date | string;
  endTime?: Date | string | null;
  notes?: string | null;
}

export interface DriverAssignmentResponse {
  id: string;
  driverId: string;
  driverName?: string;
  driverMobile?: string;
  vehicleId: string;
  registrationNumber?: string;
  vehicleTypeCode?: string;
  partnerId: string;
  partnerBusinessName?: string;
  assignmentStatus: string;
  startTime: string;
  endTime: string | null;
  actualStartTime: string | null;
  actualEndTime: string | null;
  notes: string | null;
  cancellationReason: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DriverDutyAvailabilityResponse {
  driverId: string;
  isOnline: boolean;
  isBusy: boolean;
  currentAssignmentId: string | null;
  lastHeartbeatAt: string;
}

export interface StartAssignmentOptions {
  confirmVehiclePossession?: boolean;
  initialOdometerReading?: number;
}

// ============================================================================
// Driver Assignment & Shift Lifecycle Service
// ============================================================================

export class DriverAssignmentService {
  private readonly earlyStartWindowMinutes: number;

  constructor(
    private assignmentRepo: DriverVehicleAssignmentRepository = new DriverVehicleAssignmentRepository(),
    private availabilityRepo: DriverAvailabilityRepository = new DriverAvailabilityRepository(),
    private profileRepo: DriverProfileRepository = new DriverProfileRepository(),
    private affiliationRepo: DriverPartnerAffiliationRepository = new DriverPartnerAffiliationRepository(),
    private vehicleRepo: VehicleRepository = vehicleRepository,
    private kycValidator: DriverKycValidationService = driverKycValidationService,
    config?: { earlyStartWindowMinutes?: number }
  ) {
    this.earlyStartWindowMinutes = config?.earlyStartWindowMinutes ?? 60;
  }

  /**
   * Serializes a DriverVehicleAssignment record into an API-safe response.
   */
  private serializeAssignment(
    assignment: any,
    vehicleTypeCode?: string,
    registrationNumber?: string
  ): DriverAssignmentResponse {
    return {
      id: assignment.id.toString(),
      driverId: assignment.driverId.toString(),
      driverName: assignment.driver ? `${assignment.driver.firstName} ${assignment.driver.lastName || ''}`.trim() : undefined,
      driverMobile: assignment.driver?.user?.mobileNumber,
      vehicleId: assignment.vehicleId.toString(),
      registrationNumber: registrationNumber || assignment.vehicle?.registrationNumber,
      vehicleTypeCode: vehicleTypeCode || assignment.vehicle?.vehicleType?.typeCode,
      partnerId: assignment.partnerId.toString(),
      partnerBusinessName: assignment.partner?.businessName,
      assignmentStatus: assignment.assignmentStatus,
      startTime: assignment.startTime.toISOString(),
      endTime: assignment.endTime ? assignment.endTime.toISOString() : null,
      actualStartTime: assignment.actualStartTime ? assignment.actualStartTime.toISOString() : null,
      actualEndTime: assignment.actualEndTime ? assignment.actualEndTime.toISOString() : null,
      notes: assignment.notes,
      cancellationReason: assignment.cancellationReason,
      cancelledBy: assignment.cancelledBy ? assignment.cancelledBy.toString() : null,
      cancelledAt: assignment.cancelledAt ? assignment.cancelledAt.toISOString() : null,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
    };
  }

  /**
   * Schedules a driver-vehicle assignment for an upcoming operational window.
   *
   * Business Rules:
   * 1. Partner must own/operate the vehicle (active ownership in partner_vehicles).
   * 2. Vehicle must be VERIFIED and isActive === true.
   * 3. Driver must be APPROVED, not suspended, and actively affiliated with this partner.
   * 4. Driver licence class endorsements must be compatible with the target vehicle type.
   * 5. Driver documents must not be expired.
   * 6. Validates shift window: startTime < endTime, startTime >= NOW() - 5m.
   * 7. Kernel GiST exclusion constraints guarantee zero overlapping shifts under concurrent traffic.
   */
  public async scheduleAssignment(
    partnerUserIdInput: bigint | string,
    input: ScheduleAssignmentInput
  ): Promise<DriverAssignmentResponse> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const driverId = BigInt(input.driverId);
    const vehicleId = BigInt(input.vehicleId);

    // 1. Verify Partner
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }
    if (partner.approvalStatus !== 'APPROVED') {
      throw new ForbiddenError('Partner account is not active or approved.');
    }

    // 2. Verify Vehicle Ownership & Status
    const partnerVehicle = await this.vehicleRepo.findPartnerVehicleById(partner.id, vehicleId);
    if (!partnerVehicle || partnerVehicle.ownershipStatus !== 'ACTIVE') {
      throw new ForbiddenError(
        'Cannot assign vehicle: Vehicle is not registered under your active fleet.'
      );
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: { vehicleType: true },
    });
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found.');
    }
    if (vehicle.verificationStatus !== 'VERIFIED' || !vehicle.isActive) {
      throw new ConflictError(
        `Cannot schedule assignment: Vehicle verification status is '${vehicle.verificationStatus}' and active is ${vehicle.isActive}. Must be VERIFIED and active.`
      );
    }

    // 3. Verify Driver Profile & Status
    const driver = await this.profileRepo.findById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver profile not found.');
    }
    if (driver.approvalStatus !== 'APPROVED') {
      throw new ConflictError(
        `Cannot assign driver: Driver approval status is '${driver.approvalStatus}'. Approval required.`
      );
    }
    if (driver.suspendedAt) {
      throw new ConflictError('Cannot assign driver: Driver profile is suspended.');
    }

    // 4. Verify Active Affiliation (Vehicle owner can act as their own driver when approved and eligible)
    let affiliation = await this.affiliationRepo.findActive(driverId, partner.id);
    const isOwnerDriver = driver.userId === partner.userId;
    if (!affiliation) {
      if (isOwnerDriver) {
        // Automatically establish active self-affiliation for owner-driver
        affiliation = await this.affiliationRepo.create({
          driverId,
          partnerId: partner.id,
          affiliationStatus: 'ACTIVE',
        });
      } else {
        throw new ConflictError(
          'Cannot assign driver: Driver is not actively affiliated with your partner fleet.'
        );
      }
    }

    // 5. Verify Licence Class Compatibility & Document Expiry via KYC Service
    const vehicleTypeCode = vehicle.vehicleType?.typeCode || 'TWO_WHEELER';
    const licenceCheck = await this.kycValidator.isLicenceEligibleForVehicleClass(
      driver.licenceClasses,
      vehicleTypeCode
    );
    if (!licenceCheck.isEligible) {
      throw new ValidationError(
        licenceCheck.reason ||
          `Driver licence classes do not permit operating vehicle class '${vehicleTypeCode}'.`
      );
    }

    // Evaluate driver document expiry
    const kycResult = await this.kycValidator.validateDriverWithRepository(driverId, {
      vehicleTypeCode,
    });
    if (!kycResult.isValid && kycResult.expiredTypes.length > 0) {
      throw new ValidationError(
        `Cannot assign driver: Mandatory documents expired: ${kycResult.expiredTypes.join(', ')}`
      );
    }

    // 6. Time Window Validation
    const parsedStartTime = new Date(input.startTime);
    if (isNaN(parsedStartTime.getTime())) {
      throw new BadRequestError('Invalid startTime provided.');
    }

    let parsedEndTime: Date | null = null;
    if (input.endTime) {
      parsedEndTime = new Date(input.endTime);
      if (isNaN(parsedEndTime.getTime())) {
        throw new BadRequestError('Invalid endTime provided.');
      }
      if (parsedStartTime >= parsedEndTime) {
        throw new BadRequestError('Assignment startTime must be strictly before endTime.');
      }
    }

    // Do not allow scheduling in the deep past (> 5 minutes ago)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (parsedStartTime < fiveMinutesAgo) {
      throw new BadRequestError('Cannot schedule assignments in the past.');
    }

    // 7. Advisory Overlap Pre-Check
    const overlap = await this.assignmentRepo.checkPotentialOverlap({
      driverId,
      vehicleId,
      startTime: parsedStartTime,
      endTime: parsedEndTime,
    });

    if (overlap.hasDriverOverlap) {
      throw new ConflictError(
        'Driver already has an active or scheduled assignment overlapping this time window.'
      );
    }
    if (overlap.hasVehicleOverlap) {
      throw new ConflictError(
        'Vehicle already has an active or scheduled assignment overlapping this time window.'
      );
    }

    // 8. Create Assignment (Authoritative PostgreSQL GiST Exclusion Guard)
    const assignment = await this.assignmentRepo.create({
      driverId,
      vehicleId,
      partnerId: partner.id,
      assignmentStatus: 'SCHEDULED',
      startTime: parsedStartTime,
      endTime: parsedEndTime,
      notes: input.notes ? input.notes.trim() : null,
    });

    logger.info(
      `[Driver Assignment] Partner ${partner.id.toString()} scheduled Driver ${driverId.toString()} on Vehicle ${vehicleId.toString()} from ${parsedStartTime.toISOString()} (Assignment ID: ${assignment.id.toString()})`
    );

    return this.serializeAssignment(
      assignment,
      vehicle.vehicleType?.typeCode,
      vehicle.registrationNumber
    );
  }

  /**
   * Option A: Driver explicitly starts a shift from the Partner App.
   *
   * Business Rules:
   * 1. Must be initiated by the assigned driver user.
   * 2. Assignment must be in SCHEDULED status.
   * 3. Confirms possession of assigned vehicle.
   * 4. Current time must be within start window (at most 60m before startTime and before endTime).
   * 5. Atomically sets status to ACTIVE, actualStartTime = NOW().
   * 6. Updates DriverAvailability to isOnline: true, isBusy: true, currentAssignmentId: assignment.id.
   */
  public async startAssignment(
    assignmentIdInput: bigint | string,
    driverUserIdInput: bigint | string,
    options?: StartAssignmentOptions
  ): Promise<DriverAssignmentResponse> {
    const assignmentId = BigInt(assignmentIdInput);
    const driverUserId = BigInt(driverUserIdInput);

    // Explicit confirmation of vehicle possession check
    if (options && options.confirmVehiclePossession === false) {
      throw new ValidationError(
        'Explicit confirmation of vehicle possession is required to start shift.'
      );
    }

    const profile = await this.profileRepo.findByUserId(driverUserId);
    if (!profile) {
      throw new NotFoundError('Driver profile not found.');
    }

    const assignment = await this.assignmentRepo.findById(assignmentId);
    if (!assignment) {
      throw new NotFoundError(`Assignment with ID ${assignmentId.toString()} not found.`);
    }

    if (assignment.driverId !== profile.id) {
      throw new ForbiddenError('You can only start assignments assigned directly to you.');
    }

    if (assignment.assignmentStatus !== 'SCHEDULED') {
      throw new ConflictError(
        `Cannot start assignment: Current status is '${assignment.assignmentStatus}'. Only SCHEDULED shifts can be started.`
      );
    }

    // Start tolerance window validation (configurable, default 60 minutes)
    const now = new Date();
    const earlyToleranceMs = this.earlyStartWindowMinutes * 60 * 1000;
    const earliestAllowedStart = new Date(assignment.startTime.getTime() - earlyToleranceMs);
    if (now < earliestAllowedStart) {
      throw new BadRequestError(
        `Cannot start shift more than ${this.earlyStartWindowMinutes} minutes before scheduled start time.`
      );
    }

    if (assignment.endTime && now > assignment.endTime) {
      throw new BadRequestError('Scheduled shift end time has already elapsed.');
    }

    // Verify driver is not already busy on another assignment
    const availability = await this.availabilityRepo.findByDriverId(profile.id);
    if (availability && availability.isBusy && availability.currentAssignmentId) {
      throw new ConflictError(
        `Driver already has an active shift in progress (Assignment ID: ${availability.currentAssignmentId.toString()}). Complete it first.`
      );
    }

    // Atomic shift activation and availability tracking
    const updated = await prisma.$transaction(async (tx) => {
      const activeAssignment = await this.assignmentRepo.startAssignment(assignmentId, now, tx);

      // Upsert availability
      await this.availabilityRepo.upsertAvailability(
        profile.id,
        {
          isOnline: true,
          isBusy: true,
          currentAssignmentId: assignmentId,
        },
        tx
      );

      return activeAssignment;
    });

    logger.info(
      `[Driver Shift Lifecycle] Driver ${profile.id.toString()} activated shift ${assignmentId.toString()} at ${now.toISOString()}`
    );

    return this.serializeAssignment(updated);
  }

  /**
   * Completes an active shift.
   *
   * Business Rules:
   * 1. Can be completed by the driver or fleet owner.
   * 2. Assignment must be in ACTIVE status.
   * 3. Sets assignmentStatus to COMPLETED, actualEndTime = NOW().
   * 4. Updates DriverAvailability: isBusy: false, currentAssignmentId: null.
   */
  public async completeAssignment(
    assignmentIdInput: bigint | string,
    callerUserIdInput: bigint | string,
    notes?: string
  ): Promise<DriverAssignmentResponse> {
    const assignmentId = BigInt(assignmentIdInput);
    const callerUserId = BigInt(callerUserIdInput);

    const assignment = await this.assignmentRepo.findById(assignmentId);
    if (!assignment) {
      throw new NotFoundError(`Assignment with ID ${assignmentId.toString()} not found.`);
    }

    // Verify caller is either the assigned driver or the fleet owner
    const driver = await this.profileRepo.findById(assignment.driverId);
    const partner = await prisma.partnerProfile.findUnique({
      where: { id: assignment.partnerId },
    });

    const isDriver = driver?.userId === callerUserId;
    const isPartner = partner?.userId === callerUserId;

    if (!isDriver && !isPartner) {
      throw new ForbiddenError('You do not have permission to complete this assignment.');
    }

    if (assignment.assignmentStatus !== 'ACTIVE') {
      throw new ConflictError(
        `Cannot complete assignment: Current status is '${assignment.assignmentStatus}'. Only ACTIVE shifts can be completed.`
      );
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const completed = await this.assignmentRepo.completeAssignment(
        assignmentId,
        now,
        notes ? notes.trim() : undefined,
        tx
      );

      // Reset driver availability (driver remains online, but is no longer busy)
      await this.availabilityRepo.updateDutyStatus(assignment.driverId, true, false, tx);
      await this.availabilityRepo.updateCurrentAssignment(assignment.driverId, null, false, tx);

      return completed;
    });

    logger.info(
      `[Driver Shift Lifecycle] Assignment ${assignmentId.toString()} completed at ${now.toISOString()}`
    );

    return this.serializeAssignment(updated);
  }

  /**
   * Shift Cancellation Policy Enforcement.
   *
   * Business Rules:
   * 1. Scheduled shift:
   *    - Driver self-service allowed when >= 2 hours before start time.
   *    - Within 2 hours of start: driver cancellation is blocked; requires owner/admin intervention.
   *    - Partner owner can cancel scheduled shift at any time before start.
   *    - Admin can cancel at any time.
   * 2. Active shift:
   *    - Driver unilateral cancellation is blocked.
   *    - Owner or Admin intervention is required to cancel an active shift.
   *    - Sets actualEndTime = NOW(), resets driver availability.
   */
  public async cancelAssignment(
    assignmentIdInput: bigint | string,
    callerUserIdInput: bigint | string,
    callerRole: 'DRIVER' | 'PARTNER' | 'ADMIN',
    reason: string,
    options?: {
      ownerApproved?: boolean;
      ownerUserId?: bigint | string;
      ownerApprovalNotes?: string;
    }
  ): Promise<DriverAssignmentResponse> {
    const assignmentId = BigInt(assignmentIdInput);
    const callerUserId = BigInt(callerUserIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Cancellation reason is mandatory.');
    }

    const assignment = await this.assignmentRepo.findById(assignmentId);
    if (!assignment) {
      throw new NotFoundError(`Assignment with ID ${assignmentId.toString()} not found.`);
    }

    if (assignment.assignmentStatus === 'COMPLETED' || assignment.assignmentStatus === 'CANCELLED') {
      throw new ConflictError(
        `Cannot cancel assignment: Shift is already in final status '${assignment.assignmentStatus}'.`
      );
    }

    const driver = await this.profileRepo.findById(assignment.driverId);
    const partner = await prisma.partnerProfile.findUnique({
      where: { id: assignment.partnerId },
    });

    const isDriverCaller = driver?.userId === callerUserId;
    const isPartnerCaller = partner?.userId === callerUserId;

    // -------------------------------------------------------------------------
    // Case 1: SCHEDULED Shift Cancellation
    // -------------------------------------------------------------------------
    if (assignment.assignmentStatus === 'SCHEDULED') {
      if (callerRole === 'DRIVER' || isDriverCaller) {
        if (!isDriverCaller) {
          throw new ForbiddenError('You can only cancel your own scheduled assignments.');
        }

        const now = new Date();
        const msRemaining = assignment.startTime.getTime() - now.getTime();
        const hoursRemaining = msRemaining / (1000 * 60 * 60);

        // 2-Hour Cancellation Rule
        if (hoursRemaining < 2) {
          if (options?.ownerApproved && options?.ownerUserId) {
            if (options.ownerUserId.toString() !== partner?.userId.toString()) {
              throw new ForbiddenError(
                'Owner approval for late driver cancellation must be provided by the vehicle fleet owner.'
              );
            }
          } else {
            throw new ValidationError(
              'Driver cancellation is blocked within 2 hours of scheduled shift start. Fleet owner approval required.'
            );
          }
        }
      } else if (callerRole === 'PARTNER' || isPartnerCaller) {
        if (!isPartnerCaller) {
          throw new ForbiddenError('Cannot cancel assignments for another partner fleet.');
        }
        // Partners can cancel scheduled shifts at any time
      } else if (callerRole !== 'ADMIN') {
        throw new ForbiddenError('Unauthorized to cancel this assignment.');
      }

      const cancelled = await this.assignmentRepo.cancelAssignment(
        assignmentId,
        callerUserId,
        reason.trim(),
        new Date()
      );

      logger.info(
        `[Driver Assignment] SCHEDULED Assignment ${assignmentId.toString()} cancelled by user ${callerUserId.toString()} (${callerRole}). Reason: ${reason}`
      );

      return this.serializeAssignment(cancelled);
    }

    // -------------------------------------------------------------------------
    // Case 2: ACTIVE Shift Cancellation
    // -------------------------------------------------------------------------
    if (assignment.assignmentStatus === 'ACTIVE') {
      // Driver cannot unilaterally cancel an active shift
      if (callerRole === 'DRIVER' || isDriverCaller) {
        throw new ValidationError(
          'Driver cannot unilaterally cancel an active shift. Please complete the shift or contact the fleet owner.'
        );
      }

      if (callerRole === 'PARTNER' && !isPartnerCaller) {
        throw new ForbiddenError('Cannot cancel active shifts for another partner fleet.');
      }

      const now = new Date();

      const cancelled = await prisma.$transaction(async (tx) => {
        const updatedAssignment = await tx.driverVehicleAssignment.update({
          where: { id: assignmentId },
          data: {
            assignmentStatus: 'CANCELLED',
            actualEndTime: now,
            cancelledBy: callerUserId,
            cancellationReason: reason.trim(),
            cancelledAt: now,
          },
        });

        // Reset driver availability
        await this.availabilityRepo.updateDutyStatus(assignment.driverId, true, false, tx);
        await this.availabilityRepo.updateCurrentAssignment(assignment.driverId, null, false, tx);

        return updatedAssignment;
      });

      logger.info(
        `[Driver Assignment] ACTIVE Assignment ${assignmentId.toString()} terminated by user ${callerUserId.toString()} (${callerRole}). Reason: ${reason}`
      );

      return this.serializeAssignment(cancelled);
    }

    throw new BadRequestError(`Unsupported assignment status: ${assignment.assignmentStatus}`);
  }

  /**
   * Fleet owner approves driver's late cancellation request within 2 hours of scheduled start.
   * Records actor (owner), reason (driver request + owner notes), timestamp, and CANCELLED outcome.
   */
  public async approveDriverCancellation(
    assignmentIdInput: bigint | string,
    partnerUserIdInput: bigint | string,
    options: {
      driverCancellationReason: string;
      ownerApprovalNotes?: string;
    }
  ): Promise<DriverAssignmentResponse> {
    const assignmentId = BigInt(assignmentIdInput);
    const partnerUserId = BigInt(partnerUserIdInput);

    const assignment = await this.assignmentRepo.findById(assignmentId);
    if (!assignment) {
      throw new NotFoundError(`Assignment with ID ${assignmentId.toString()} not found.`);
    }

    const partner = await prisma.partnerProfile.findUnique({
      where: { id: assignment.partnerId },
    });
    if (!partner || partner.userId !== partnerUserId) {
      throw new ForbiddenError(
        'Only the fleet partner owner can approve late shift cancellation.'
      );
    }

    const recordedReason = `[Owner Approved Late Cancellation] Driver reason: ${options.driverCancellationReason}${
      options.ownerApprovalNotes ? ` | Owner notes: ${options.ownerApprovalNotes}` : ''
    }`;

    return this.cancelAssignment(
      assignmentId,
      partnerUserId,
      'PARTNER',
      recordedReason
    );
  }

  /**
   * Heartbeat telemetry tracking.
   * Updates lastHeartbeatAt. Heartbeats NEVER reactivate cancelled or completed shifts.
   */
  public async updateHeartbeat(
    driverUserIdInput: bigint | string,
    telemetry?: { isOnline?: boolean }
  ): Promise<DriverDutyAvailabilityResponse> {
    const driverUserId = BigInt(driverUserIdInput);
    const profile = await this.profileRepo.findByUserId(driverUserId);
    if (!profile) {
      throw new NotFoundError('Driver profile not found.');
    }

    const currentAvailability = await this.availabilityRepo.findByDriverId(profile.id);

    // Verify current assignment is still ACTIVE (prevents stale active states)
    let validCurrentAssignmentId = currentAvailability?.currentAssignmentId;
    let isBusy = currentAvailability?.isBusy || false;

    if (validCurrentAssignmentId) {
      const activeCheck = await this.assignmentRepo.findById(validCurrentAssignmentId);
      if (!activeCheck || activeCheck.assignmentStatus !== 'ACTIVE') {
        validCurrentAssignmentId = null;
        isBusy = false;
      }
    }

    await this.availabilityRepo.upsertAvailability(profile.id, {
      isOnline: telemetry?.isOnline !== undefined ? telemetry.isOnline : currentAvailability?.isOnline ?? true,
      isBusy,
      currentAssignmentId: validCurrentAssignmentId,
    });
    const updated = await this.availabilityRepo.updateHeartbeat(profile.id);

    return {
      driverId: updated.driverId.toString(),
      isOnline: updated.isOnline,
      isBusy: updated.isBusy,
      currentAssignmentId: updated.currentAssignmentId ? updated.currentAssignmentId.toString() : null,
      lastHeartbeatAt: updated.lastHeartbeatAt.toISOString(),
    };
  }

  /**
   * Retrieves duty availability status for driver.
   */
  public async getDutyStatus(
    driverUserIdInput: bigint | string
  ): Promise<DriverDutyAvailabilityResponse> {
    const driverUserId = BigInt(driverUserIdInput);
    const profile = await this.profileRepo.findByUserId(driverUserId);
    if (!profile) {
      throw new NotFoundError('Driver profile not found.');
    }

    let availability = await this.availabilityRepo.findByDriverId(profile.id);
    if (!availability) {
      availability = await this.availabilityRepo.upsertAvailability(profile.id, {
        isOnline: false,
        isBusy: false,
      });
    }

    return {
      driverId: availability.driverId.toString(),
      isOnline: availability.isOnline,
      isBusy: availability.isBusy,
      currentAssignmentId: availability.currentAssignmentId
        ? availability.currentAssignmentId.toString()
        : null,
      lastHeartbeatAt: availability.lastHeartbeatAt.toISOString(),
    };
  }

  /**
   * Toggles online duty state (ONLINE vs OFFLINE).
   * Driver cannot go OFFLINE while in an ACTIVE shift.
   */
  public async toggleOnlineStatus(
    driverUserIdInput: bigint | string,
    isOnline: boolean
  ): Promise<DriverDutyAvailabilityResponse> {
    const driverUserId = BigInt(driverUserIdInput);
    const profile = await this.profileRepo.findByUserId(driverUserId);
    if (!profile) {
      throw new NotFoundError('Driver profile not found.');
    }

    const current = await this.availabilityRepo.findByDriverId(profile.id);
    if (!isOnline && current?.isBusy && current.currentAssignmentId) {
      throw new ConflictError(
        'Cannot go offline while in an active shift. Please complete your shift first.'
      );
    }

    const updated = await this.availabilityRepo.upsertAvailability(profile.id, {
      isOnline,
      isBusy: isOnline ? (current?.isBusy || false) : false,
      currentAssignmentId: isOnline ? current?.currentAssignmentId : null,
    });

    return {
      driverId: updated.driverId.toString(),
      isOnline: updated.isOnline,
      isBusy: updated.isBusy,
      currentAssignmentId: updated.currentAssignmentId ? updated.currentAssignmentId.toString() : null,
      lastHeartbeatAt: updated.lastHeartbeatAt.toISOString(),
    };
  }

  /**
   * Lists assignments created by the partner fleet.
   */
  public async listPartnerAssignments(
    partnerUserIdInput: bigint | string,
    filter?: { status?: string },
    options?: PaginationOptions
  ): Promise<PaginatedResult<DriverAssignmentResponse>> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const result = await this.assignmentRepo.listByPartner(
      partner.id,
      filter?.status,
      options
    );

    return {
      items: result.items.map((a: any) => this.serializeAssignment(a)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Retrieves an assignment for the partner fleet.
   */
  public async getPartnerAssignmentById(
    partnerUserIdInput: bigint | string,
    assignmentIdInput: bigint | string
  ): Promise<DriverAssignmentResponse> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const assignmentId = BigInt(assignmentIdInput);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const assignment = await this.assignmentRepo.findById(assignmentId);
    if (!assignment) {
      throw new NotFoundError(`Assignment with ID ${assignmentId.toString()} not found.`);
    }

    if (assignment.partnerId !== partner.id) {
      throw new ForbiddenError('You do not have permission to view assignments of another fleet.');
    }

    return this.serializeAssignment(assignment);
  }

  /**
   * Lists assignments assigned to the authenticated driver.
   */
  public async listDriverAssignments(
    driverUserIdInput: bigint | string,
    filter?: { status?: string },
    options?: PaginationOptions
  ): Promise<PaginatedResult<DriverAssignmentResponse>> {
    const driverUserId = BigInt(driverUserIdInput);
    const driver = await this.profileRepo.findByUserId(driverUserId);
    if (!driver) {
      throw new NotFoundError('Driver profile not found.');
    }

    const result = await this.assignmentRepo.listByDriver(
      driver.id,
      filter?.status,
      options
    );

    return {
      items: result.items.map((a: any) => this.serializeAssignment(a)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Retrieves an assignment for the authenticated driver.
   */
  public async getDriverAssignmentById(
    driverUserIdInput: bigint | string,
    assignmentIdInput: bigint | string
  ): Promise<DriverAssignmentResponse> {
    const driverUserId = BigInt(driverUserIdInput);
    const assignmentId = BigInt(assignmentIdInput);

    const driver = await this.profileRepo.findByUserId(driverUserId);
    if (!driver) {
      throw new NotFoundError('Driver profile not found.');
    }

    const assignment = await this.assignmentRepo.findById(assignmentId);
    if (!assignment) {
      throw new NotFoundError(`Assignment with ID ${assignmentId.toString()} not found.`);
    }

    if (assignment.driverId !== driver.id) {
      throw new ForbiddenError('You do not have permission to view assignments of another driver.');
    }

    return this.serializeAssignment(assignment);
  }
}

export const driverAssignmentService = new DriverAssignmentService();
