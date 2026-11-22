import { Prisma, WorkerAvailability, WorkerProfile } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import { redisClient, isRedisAvailable } from '../../../config/redis.config';
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

// ============================================================================
// Constants & Configuration
// ============================================================================

/**
 * Worker Heartbeat Timeout Policy:
 * If an online worker does not send a heartbeat within 5 minutes (300,000 ms),
 * they are treated as STALE_OFFLINE and excluded from dispatch allocations.
 */
export const HEARTBEAT_STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Worker Dispatch Lock Policy:
 * Default TTL: 60 seconds (60,000 ms).
 * Maximum permitted TTL: 300 seconds (300,000 ms).
 * Prevents race conditions during simultaneous booking matching.
 */
export const DEFAULT_DISPATCH_LOCK_TTL_MS = 60 * 1000;
export const MAX_DISPATCH_LOCK_TTL_MS = 300 * 1000;

// ============================================================================
// Types & DTOs
// ============================================================================

export interface CoordinatesInput {
  latitude?: number | null;
  longitude?: number | null;
}

export interface WorkerAvailabilityResponse {
  id: string;
  workerId: string;
  isOnline: boolean;
  isBusy: boolean;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastHeartbeatAt: string;
  isStale: boolean;
  updatedAt: string;
}

export interface WorkerOperationalStatusResponse {
  workerId: string;
  workerType: string;
  approvalStatus: string;
  isSuspended: boolean;
  isOnline: boolean;
  isBusy: boolean;
  isStale: boolean;
  isOperationallyAvailable: boolean;
  kycCompliant: boolean;
  lastHeartbeatAt: string | null;
  coordinates: {
    latitude: number | null;
    longitude: number | null;
  };
  reasonsIfNotAvailable: string[];
}

export interface DispatchLockContext {
  lockKey?: string;
  lockOwner: string;
  lockTtlMs?: number;
  ttlSeconds?: number;
}

// In-process fallback lock storage for degraded mode or tests without live Redis
interface LocalLockEntry {
  owner: string;
  expiresAt: number;
}

const localDispatchLockStore = new Map<string, LocalLockEntry>();

// ============================================================================
// Worker Availability Service
// ============================================================================

export class WorkerAvailabilityService {
  constructor(
    private availabilityRepo: WorkerAvailabilityRepository = new WorkerAvailabilityRepository(),
    private profileRepo: WorkerProfileRepository = new WorkerProfileRepository(),
    private kycValidator: WorkerKycValidationService = workerKycValidationService
  ) {}

  /**
   * Validates geographic latitude and longitude bounds.
   * Latitude must be in [-90, 90], Longitude in [-180, 180].
   */
  public validateCoordinates(coords?: CoordinatesInput): void {
    if (!coords) return;

    if (coords.latitude !== undefined && coords.latitude !== null) {
      const lat = Number(coords.latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        throw new BadRequestError('Invalid coordinates: Latitude must be a number between -90 and 90 degrees.');
      }
    }

    if (coords.longitude !== undefined && coords.longitude !== null) {
      const lng = Number(coords.longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        throw new BadRequestError('Invalid coordinates: Longitude must be a number between -180 and 180 degrees.');
      }
    }
  }

  /**
   * Determines whether an availability record is stale based on heartbeat timeout policy.
   */
  public isAvailabilityStale(lastHeartbeatAt: Date, now: Date = new Date()): boolean {
    return now.getTime() - lastHeartbeatAt.getTime() > HEARTBEAT_STALE_TIMEOUT_MS;
  }

  /**
   * Serializes a WorkerAvailability record into an API-safe response.
   */
  private serializeAvailability(
    availability: WorkerAvailability,
    now: Date = new Date()
  ): WorkerAvailabilityResponse {
    const isStale = availability.isOnline && this.isAvailabilityStale(availability.lastHeartbeatAt, now);

    return {
      id: availability.id.toString(),
      workerId: availability.workerId.toString(),
      isOnline: availability.isOnline,
      isBusy: availability.isBusy,
      currentLatitude: availability.currentLatitude ? Number(availability.currentLatitude) : null,
      currentLongitude: availability.currentLongitude ? Number(availability.currentLongitude) : null,
      lastHeartbeatAt: availability.lastHeartbeatAt.toISOString(),
      isStale,
      updatedAt: availability.updatedAt.toISOString(),
    };
  }

  /**
   * Retrieves availability record for the authenticated worker.
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
      availability = await this.availabilityRepo.upsertAvailability(profile.id, {
        isOnline: false,
        isBusy: false,
      });
    }

    return this.serializeAvailability(availability);
  }

  /**
   * Toggles worker availability to ONLINE.
   *
   * Business Rules:
   * 1. Only approved workers can go online (`approvalStatus === 'APPROVED'`).
   * 2. Cannot go online if suspended.
   * 3. Cannot go online if mandatory KYC documents or required skills are expired or missing.
   * 4. Does NOT require any partner affiliation (independent worker availability supported).
   * 5. Validates geographic coordinates if provided.
   */
  public async goOnline(
    workerUserIdInput: bigint | string,
    coordinates?: CoordinatesInput
  ): Promise<WorkerAvailabilityResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    // 1. Approval and suspension guards
    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended. Cannot toggle online availability.');
    }

    if (profile.approvalStatus !== 'APPROVED') {
      throw new ForbiddenError(
        `Only approved service workers can toggle online availability (current status: '${profile.approvalStatus}').`
      );
    }

    if (!profile.isActive) {
      throw new ForbiddenError('Worker profile is inactive. Cannot toggle online availability.');
    }

    // 2. Validate KYC compliance and skill verification
    const kycResult = await this.kycValidator.validateWorkerWithRepository(profile.id);
    if (!kycResult.isValid) {
      logger.warn(
        `[Worker Availability] Worker ${profile.id.toString()} blocked from going online due to incomplete/expired KYC: ${kycResult.reasons.join('; ')}`
      );
      throw new ForbiddenError(
        `Worker KYC compliance or skill verification is incomplete or expired. Cannot go online: ${kycResult.reasons.join(', ')}`
      );
    }

    // 3. Coordinate validation
    this.validateCoordinates(coordinates);

    // 4. Update availability to online
    const updated = await this.availabilityRepo.upsertAvailability(profile.id, {
      isOnline: true,
      isBusy: false,
      currentLatitude: coordinates?.latitude !== undefined && coordinates?.latitude !== null ? coordinates.latitude : undefined,
      currentLongitude: coordinates?.longitude !== undefined && coordinates?.longitude !== null ? coordinates.longitude : undefined,
      lastHeartbeatAt: new Date(),
    });

    logger.info(`[Worker Availability] Worker ${profile.id.toString()} transitioned to ONLINE`);

    return this.serializeAvailability(updated);
  }

  /**
   * Toggles worker availability to OFFLINE.
   */
  public async goOffline(
    workerUserIdInput: bigint | string
  ): Promise<WorkerAvailabilityResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const updated = await this.availabilityRepo.updateDutyStatus(profile.id, false, false);

    logger.info(`[Worker Availability] Worker ${profile.id.toString()} transitioned to OFFLINE`);

    return this.serializeAvailability(updated);
  }

  /**
   * Updates worker heartbeat and optional coordinates.
   *
   * Business Rules:
   * 1. Updating heartbeat must NOT automatically reactivate an offline or suspended worker.
   * 2. If worker is suspended, heartbeat update is rejected.
   * 3. If worker is currently offline, heartbeat timestamp is updated, but isOnline remains false.
   * 4. Validates coordinates.
   */
  public async updateHeartbeat(
    workerUserIdInput: bigint | string,
    coordinates?: CoordinatesInput
  ): Promise<WorkerAvailabilityResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    if (profile.suspendedAt) {
      throw new ForbiddenError('Worker profile is suspended. Heartbeat update rejected.');
    }

    this.validateCoordinates(coordinates);

    const currentAvailability = await this.availabilityRepo.findByWorkerId(profile.id);
    const currentIsOnline = currentAvailability?.isOnline ?? false;
    const currentIsBusy = currentAvailability?.isBusy ?? false;

    // Preserves current isOnline state (offline worker remains offline)
    const updated = await this.availabilityRepo.upsertAvailability(profile.id, {
      isOnline: currentIsOnline,
      isBusy: currentIsBusy,
      currentLatitude: coordinates?.latitude !== undefined && coordinates?.latitude !== null ? coordinates.latitude : undefined,
      currentLongitude: coordinates?.longitude !== undefined && coordinates?.longitude !== null ? coordinates.longitude : undefined,
      lastHeartbeatAt: new Date(),
    });

    return this.serializeAvailability(updated);
  }

  /**
   * Evaluates comprehensive operational status of a worker for dispatch readiness.
   */
  public async getOperationalAvailability(
    workerUserIdInput: bigint | string
  ): Promise<WorkerOperationalStatusResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const [availability, kycResult] = await Promise.all([
      this.availabilityRepo.findByWorkerId(profile.id),
      this.kycValidator.validateWorkerWithRepository(profile.id),
    ]);

    const isSuspended = !!profile.suspendedAt;
    const isApproved = profile.approvalStatus === 'APPROVED';
    const isOnline = availability?.isOnline || false;
    const isBusy = availability?.isBusy || false;
    const now = new Date();
    const isStale = isOnline && !!availability?.lastHeartbeatAt && this.isAvailabilityStale(availability.lastHeartbeatAt, now);

    const reasonsIfNotAvailable: string[] = [];

    if (!isApproved) {
      reasonsIfNotAvailable.push(`Worker is not approved (status: '${profile.approvalStatus}')`);
    }
    if (isSuspended) {
      reasonsIfNotAvailable.push('Worker account is suspended');
    }
    if (!kycResult.isValid) {
      reasonsIfNotAvailable.push(`KYC compliance or skill requirements invalid: ${kycResult.reasons.join(', ')}`);
    }
    if (!isOnline) {
      reasonsIfNotAvailable.push('Worker is currently offline');
    }
    if (isBusy) {
      reasonsIfNotAvailable.push('Worker is currently busy on an active task');
    }
    if (isStale) {
      reasonsIfNotAvailable.push('Worker heartbeat is stale (> 5 minutes elapsed)');
    }

    const isOperationallyAvailable =
      isApproved && !isSuspended && kycResult.isValid && isOnline && !isBusy && !isStale;

    return {
      workerId: profile.id.toString(),
      workerType: profile.workerType,
      approvalStatus: profile.approvalStatus,
      isSuspended,
      isOnline,
      isBusy,
      isStale,
      isOperationallyAvailable,
      kycCompliant: kycResult.isValid,
      lastHeartbeatAt: availability?.lastHeartbeatAt ? availability.lastHeartbeatAt.toISOString() : null,
      coordinates: {
        latitude: availability?.currentLatitude ? Number(availability.currentLatitude) : null,
        longitude: availability?.currentLongitude ? Number(availability.currentLongitude) : null,
      },
      reasonsIfNotAvailable,
    };
  }

  /**
   * Acquires an atomic dispatch lock for a worker during matching/allocation.
   *
   * Business Rules:
   * 1. Concurrent lock acquisition is atomic.
   * 2. Uses Redis NX PX when available; falls back to atomic in-process lock in degraded mode.
   * 3. Prevents conflicting simultaneous booking allocations.
   * 4. Enforces TTL bounds (default 60s, max 300s).
   */
  public async setDispatchLock(
    workerIdInput: bigint | string,
    lockContext: DispatchLockContext
  ): Promise<{
    acquired: boolean;
    lockKey: string;
    expiresAt: Date;
    lockOwner?: string;
    existingLockOwner?: string;
  }> {
    const workerId = BigInt(workerIdInput);
    const ttlMs = Math.min(
      Math.max(
        1000,
        lockContext.ttlSeconds ? lockContext.ttlSeconds * 1000 : (lockContext.lockTtlMs || DEFAULT_DISPATCH_LOCK_TTL_MS)
      ),
      MAX_DISPATCH_LOCK_TTL_MS
    );
    const lockKey = lockContext.lockKey || `worker:dispatch_lock:${workerId.toString()}`;
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs);

    // Redis distributed lock
    if (isRedisAvailable && redisClient) {
      try {
        const result = await redisClient.set(lockKey, lockContext.lockOwner, 'PX', ttlMs, 'NX');
        if (result === 'OK') {
          return { acquired: true, lockKey, expiresAt, lockOwner: lockContext.lockOwner };
        }
        const existingOwner = await redisClient.get(lockKey);
        return { acquired: false, lockKey, expiresAt, existingLockOwner: existingOwner || undefined };
      } catch (err) {
        logger.warn(`[Dispatch Lock Redis] Redis lock acquisition failed (${(err as any)?.message}). Falling back to local lock.`);
      }
    }

    // Atomic in-process fallback lock store
    const existing = localDispatchLockStore.get(lockKey);
    if (existing && existing.expiresAt > now) {
      // Lock held by another owner
      return {
        acquired: false,
        lockKey,
        expiresAt: new Date(existing.expiresAt),
        existingLockOwner: existing.owner,
      };
    }

    localDispatchLockStore.set(lockKey, {
      owner: lockContext.lockOwner,
      expiresAt: now + ttlMs,
    });

    return { acquired: true, lockKey, expiresAt, lockOwner: lockContext.lockOwner };
  }

  /**
   * Releases an atomic dispatch lock.
   *
   * Business Rules:
   * 1. Verifies lock ownership: A worker/dispatch caller cannot release another caller's lock.
   * 2. If caller is not owner, release fails.
   * 3. If forceRelease is true, lock is released unconditionally.
   */
  public async releaseDispatchLock(
    workerIdInput: bigint | string,
    lockContext: { lockKey?: string; lockOwner?: string; forceRelease?: boolean }
  ): Promise<{ released: boolean }> {
    const workerId = BigInt(workerIdInput);
    const lockKey = lockContext.lockKey || `worker:dispatch_lock:${workerId.toString()}`;

    // Redis distributed lock release with ownership verification
    if (isRedisAvailable && redisClient) {
      try {
        if (lockContext.forceRelease) {
          await redisClient.del(lockKey);
          return { released: true };
        }

        const currentOwner = await redisClient.get(lockKey);
        if (!currentOwner) {
          return { released: true }; // Lock already expired or released
        }
        if (currentOwner !== lockContext.lockOwner) {
          logger.warn(
            `[Dispatch Lock Security] Unauthorized release attempt on lock ${lockKey}. Expected owner '${currentOwner}', got '${lockContext.lockOwner}'`
          );
          return { released: false };
        }
        await redisClient.del(lockKey);
        return { released: true };
      } catch (err) {
        logger.warn(`[Dispatch Lock Redis] Redis lock release failed (${(err as any)?.message}).`);
      }
    }

    // Local in-process lock release
    if (lockContext.forceRelease) {
      localDispatchLockStore.delete(lockKey);
      return { released: true };
    }

    const existing = localDispatchLockStore.get(lockKey);
    if (!existing || existing.expiresAt <= Date.now()) {
      localDispatchLockStore.delete(lockKey);
      return { released: true };
    }

    if (existing.owner !== lockContext.lockOwner) {
      logger.warn(
        `[Dispatch Lock Security] Unauthorized release attempt on lock ${lockKey}. Expected owner '${existing.owner}', got '${lockContext.lockOwner}'`
      );
      return { released: false };
    }

    localDispatchLockStore.delete(lockKey);
    return { released: true };
  }
}

// Default singleton export
export const workerAvailabilityService = new WorkerAvailabilityService();
