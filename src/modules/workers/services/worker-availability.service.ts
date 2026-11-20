import crypto from 'crypto';
import { Prisma, WorkerAvailability } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../../common/errors';
import { WorkerAvailabilityRepository } from '../repositories/worker-availability.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import {
  WorkerKycValidationService,
  workerKycValidationService,
} from './worker-kyc.service';
import {
  WorkerAvailabilityResponse,
  DispatchLockContext,
  DispatchLockResponse,
} from '../workers.types';

// ============================================================================
// Configuration Constants
// ============================================================================

/** Heartbeat timeout: Worker heartbeat older than 5 minutes is deemed stale / inactive */
export const WORKER_HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Dispatch Lock TTL: Locks auto-expire after 120 seconds to prevent deadlocks if dispatch aborts */
export const DEFAULT_DISPATCH_LOCK_TTL_SECONDS = 120; // 2 minutes

interface ActiveLockEntry {
  lockId: string;
  workerId: string;
  expiresAt: Date;
  context?: DispatchLockContext;
}

// ============================================================================
// Worker Availability & Dispatch Lock Service
// ============================================================================

export class WorkerAvailabilityService {
  /** In-memory lock registry for local process lock ownership validation */
  private activeLocks = new Map<string, ActiveLockEntry>();

  constructor(
    private availabilityRepo: WorkerAvailabilityRepository = new WorkerAvailabilityRepository(),
    private profileRepo: WorkerProfileRepository = new WorkerProfileRepository(),
    private kycValidator: WorkerKycValidationService = workerKycValidationService
  ) {}

  /**
   * Helper: Validates geographical coordinates within valid ranges.
   */
  private validateCoordinates(lat?: number | null, lng?: number | null): void {
    if (lat !== undefined && lat !== null) {
      if (typeof lat !== 'number' || isNaN(lat) || lat < -90 || lat > 90) {
        throw new BadRequestError(`Invalid latitude '${lat}'. Must be a number between -90 and 90.`);
      }
    }
    if (lng !== undefined && lng !== null) {
      if (typeof lng !== 'number' || isNaN(lng) || lng < -180 || lng > 180) {
        throw new BadRequestError(`Invalid longitude '${lng}'. Must be a number between -180 and 180.`);
      }
    }
  }

  /**
   * Helper: Determines if a heartbeat timestamp is stale.
   */
  public isHeartbeatStale(lastHeartbeatAt: Date, referenceDate: Date = new Date()): boolean {
    return referenceDate.getTime() - lastHeartbeatAt.getTime() > WORKER_HEARTBEAT_TIMEOUT_MS;
  }

  /**
   * Serializes a WorkerAvailability record into an API-safe response.
   */
  private serializeAvailability(
    availability: WorkerAvailability,
    referenceDate: Date = new Date()
  ): WorkerAvailabilityResponse {
    const isStale = this.isHeartbeatStale(availability.lastHeartbeatAt, referenceDate);

    return {
      workerId: availability.workerId.toString(),
      isOnline: availability.isOnline,
      isBusy: availability.isBusy,
      currentLatitude: availability.currentLatitude ? Number(availability.currentLatitude) : null,
      currentLongitude: availability.currentLongitude ? Number(availability.currentLongitude) : null,
      lastHeartbeatAt: availability.lastHeartbeatAt.toISOString(),
      isStale,
    };
  }

  /**
   * Retrieves availability state for the authenticated worker.
   */
  public async getMyAvailability(
    workerUserIdInput: bigint | string
  ): Promise<WorkerAvailabilityResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    let availability = await this.availabilityRepo.findByWorkerId(profile.id);
    if (!availability) {
      // Lazy initialization of default offline availability record
      availability = await this.availabilityRepo.upsertAvailability(profile.id, {
        isOnline: false,
        isBusy: false,
      });
    }

    return this.serializeAvailability(availability);
  }

  /**
   * Worker explicitly transitions duty status to ONLINE.
   *
   * Business Rules:
   * 1. Only an approved, active worker can go online (Rule 1).
   * 2. Mandatory KYC and verified skills must be compliant (Rule 2).
   * 3. Suspended or document-expired workers are blocked (Rule 3).
   * 4. Worker availability does NOT depend on partner affiliations (Rule 4 & 5).
   * 5. Validates coordinate bounds.
   */
  public async goOnline(
    workerUserIdInput: bigint | string,
    coordinates?: { latitude?: number | null; longitude?: number | null }
  ): Promise<WorkerAvailabilityResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found. Please complete onboarding.');
    }

    // 1. Profile Status Checks
    if (profile.suspendedAt || profile.approvalStatus === 'SUSPENDED') {
      throw new ForbiddenError('Cannot go online: Worker profile is suspended.');
    }

    if (profile.approvalStatus !== 'APPROVED') {
      throw new ConflictError(
        `Cannot go online: Worker profile approval status is '${profile.approvalStatus}'. Approval required.`
      );
    }

    if (!profile.isActive) {
      throw new ConflictError('Cannot go online: Worker profile is deactivated.');
    }

    // 2. KYC Compliance & Expiry Check (Fail-closed gate)
    const kycResult = await this.kycValidator.validateWorkerWithRepository(profile.id);
    if (!kycResult.isValid) {
      throw new ConflictError(
        `Cannot go online: Worker KYC or skill qualifications are not compliant. Reasons: ${kycResult.reasons.join(
          '; '
        )}`
      );
    }

    // 3. Coordinate validation
    this.validateCoordinates(coordinates?.latitude, coordinates?.longitude);

    // 4. Update availability
    const updated = await this.availabilityRepo.upsertAvailability(profile.id, {
      isOnline: true,
      isBusy: false,
      currentLatitude: coordinates?.latitude,
      currentLongitude: coordinates?.longitude,
      lastHeartbeatAt: new Date(),
    });

    logger.info(`[Worker Availability] Worker ${profile.id.toString()} went ONLINE`);

    return this.serializeAvailability(updated);
  }

  /**
   * Worker explicitly transitions duty status to OFFLINE.
   *
   * Business Rules:
   * 1. Cannot go offline if currently busy with an active dispatch/job.
   * 2. Clears busy flag and marks isOnline = false.
   */
  public async goOffline(
    workerUserIdInput: bigint | string
  ): Promise<WorkerAvailabilityResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const current = await this.availabilityRepo.findByWorkerId(profile.id);
    if (current && current.isBusy) {
      throw new ConflictError(
        'Cannot go offline while busy with an active dispatch job or assignment.'
      );
    }

    const updated = await this.availabilityRepo.updateDutyStatus(profile.id, false, false);

    logger.info(`[Worker Availability] Worker ${profile.id.toString()} went OFFLINE`);

    return this.serializeAvailability(updated);
  }

  /**
   * Worker client sends periodic heartbeat / location keep-alive.
   *
   * Business Rules:
   * 1. Heartbeat updates must NOT automatically reactivate an offline or suspended worker (Rule 6).
   * 2. If worker is suspended, throws ForbiddenError.
   * 3. Updates lastHeartbeatAt and optional coordinates without changing isOnline status.
   */
  public async updateHeartbeat(
    workerUserIdInput: bigint | string,
    coordinates?: { latitude?: number | null; longitude?: number | null }
  ): Promise<WorkerAvailabilityResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended.');
    }

    // Validate coordinates
    this.validateCoordinates(coordinates?.latitude, coordinates?.longitude);

    const current = await this.availabilityRepo.findByWorkerId(profile.id);

    // If no availability record exists or worker is currently offline, keep isOnline = false!
    const isCurrentlyOnline = current ? current.isOnline : false;

    const updated = await this.availabilityRepo.upsertAvailability(profile.id, {
      isOnline: isCurrentlyOnline, // Never silently turn an offline worker online via heartbeat
      isBusy: current ? current.isBusy : false,
      currentLatitude: coordinates?.latitude !== undefined ? coordinates.latitude : (current?.currentLatitude ? Number(current.currentLatitude) : null),
      currentLongitude: coordinates?.longitude !== undefined ? coordinates.longitude : (current?.currentLongitude ? Number(current.currentLongitude) : null),
      lastHeartbeatAt: new Date(),
    });

    return this.serializeAvailability(updated);
  }

  /**
   * Evaluates end-to-end operational eligibility and availability of a worker for booking dispatch.
   *
   * Invariants:
   * - Must be APPROVED, active, not suspended.
   * - Must be currently isOnline = true and isBusy = false.
   * - Heartbeat must not be stale (within 5 minutes).
   * - KYC and required skills must be valid and unexpired.
   * - Independent: does NOT require partner affiliation.
   */
  public async getOperationalAvailability(
    workerIdInput: bigint | string,
    referenceDate: Date = new Date()
  ): Promise<{ isOperational: boolean; isEligible: boolean; reason?: string }> {
    const workerId = BigInt(workerIdInput);
    const worker = await this.profileRepo.findById(workerId);

    if (!worker) {
      return { isOperational: false, isEligible: false, reason: 'Worker profile not found.' };
    }

    if (worker.approvalStatus !== 'APPROVED' || worker.suspendedAt || !worker.isActive) {
      return {
        isOperational: false,
        isEligible: false,
        reason: `Worker not operational (status: ${worker.approvalStatus}, suspended: ${!!worker.suspendedAt}, active: ${worker.isActive}).`,
      };
    }

    const availability = await this.availabilityRepo.findByWorkerId(workerId);
    if (!availability || !availability.isOnline) {
      return { isOperational: true, isEligible: false, reason: 'Worker is currently offline.' };
    }

    if (availability.isBusy) {
      return { isOperational: true, isEligible: false, reason: 'Worker is currently busy or locked.' };
    }

    // Stale check
    if (this.isHeartbeatStale(availability.lastHeartbeatAt, referenceDate)) {
      return { isOperational: true, isEligible: false, reason: 'Worker heartbeat is stale (> 5 minutes).' };
    }

    // KYC check
    const kycResult = await this.kycValidator.validateWorkerWithRepository(workerId, {}, referenceDate);
    if (!kycResult.isValid) {
      return {
        isOperational: false,
        isEligible: false,
        reason: `Worker KYC is non-compliant: ${kycResult.reasons.join('; ')}`,
      };
    }

    return { isOperational: true, isEligible: true };
  }

  /**
   * Atomically acquires a dispatch lock for a worker.
   *
   * Business Rules:
   * 1. Prevents simultaneous conflicting allocations (Rule 8).
   * 2. Atomic lock acquisition guaranteed by database conditional update (Rule 9).
   * 3. Configurable lock TTL (default 120s) prevents permanent deadlocks.
   * 4. Returns unique lock token required for release.
   */
  public async setDispatchLock(
    workerIdInput: bigint | string,
    context?: DispatchLockContext
  ): Promise<DispatchLockResponse> {
    const workerId = BigInt(workerIdInput);
    const workerKey = workerId.toString();

    // Check if worker is eligible
    const operationalCheck = await this.getOperationalAvailability(workerId);
    if (!operationalCheck.isEligible) {
      return {
        acquired: false,
        workerId: workerKey,
        reason: operationalCheck.reason || 'Worker is not eligible or available for dispatch.',
      };
    }

    // Clean up expired in-memory lock if any
    const existingLock = this.activeLocks.get(workerKey);
    if (existingLock && new Date() > existingLock.expiresAt) {
      this.activeLocks.delete(workerKey);
      await this.availabilityRepo.atomicReleaseLock(workerId);
    }

    // Atomic Database Conditional Lock: UPDATE worker_availability SET is_busy = true WHERE is_online = true AND is_busy = false
    const locked = await this.availabilityRepo.atomicAcquireLock(workerId);
    if (!locked) {
      return {
        acquired: false,
        workerId: workerKey,
        reason: 'Worker is already busy or locked by another concurrent dispatch process.',
      };
    }

    const ttlSeconds = context?.ttlSeconds || DEFAULT_DISPATCH_LOCK_TTL_SECONDS;
    const lockId = context?.lockId || crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Register active lock entry
    this.activeLocks.set(workerKey, {
      lockId,
      workerId: workerKey,
      expiresAt,
      context,
    });

    logger.info(
      `[Dispatch Lock] Acquired lock ${lockId} for worker ${workerKey} (TTL: ${ttlSeconds}s, expires: ${expiresAt.toISOString()})`
    );

    return {
      acquired: true,
      lockId,
      workerId: workerKey,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Releases an acquired dispatch lock.
   *
   * Business Rules:
   * 1. Must verify lock ownership token (lockId) (Rule 10).
   * 2. Caller cannot release another worker's lock or with mismatched token (Rule 11).
   * 3. Atomically resets isBusy = false.
   */
  public async releaseDispatchLock(
    workerIdInput: bigint | string,
    lockId: string
  ): Promise<{ released: boolean; message: string }> {
    const workerId = BigInt(workerIdInput);
    const workerKey = workerId.toString();

    if (!lockId) {
      throw new BadRequestError('Lock ID is required to release dispatch lock.');
    }

    // 1. Verify lock ownership
    const activeLock = this.activeLocks.get(workerKey);
    if (activeLock) {
      if (activeLock.lockId !== lockId) {
        logger.warn(
          `[Dispatch Lock Security] Unauthorized lock release attempt: Token '${lockId}' does not match active lock '${activeLock.lockId}' for worker ${workerKey}`
        );
        throw new ForbiddenError('Invalid or mismatched dispatch lock token.');
      }
      this.activeLocks.delete(workerKey);
    }

    // 2. Atomic Database Release
    await this.availabilityRepo.atomicReleaseLock(workerId);

    logger.info(`[Dispatch Lock] Released lock ${lockId} for worker ${workerKey}`);

    return {
      released: true,
      message: 'Dispatch lock released successfully.',
    };
  }
}

// Default singleton export
export const workerAvailabilityService = new WorkerAvailabilityService();
