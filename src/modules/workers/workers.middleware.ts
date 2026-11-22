import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/db.config';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/errors';
import { WorkerProfile } from '@prisma/client';

// Extend Express Request type to include workerProfile
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workerProfile?: WorkerProfile;
    }
  }
}

/**
 * Middleware that loads the WorkerProfile for the authenticated user.
 * Attaches the resolved profile to `req.workerProfile`.
 *
 * Security Invariants:
 * 1. Reads identity strictly from authenticated JWT context (`req.user.userId`).
 * 2. Never accepts or trusts client-supplied user IDs or worker IDs.
 * 3. Throws NotFoundError if no worker profile exists.
 * 4. Skips redundant database lookup if `req.workerProfile` is already resolved.
 */
export const requireWorkerProfile = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user || !req.user.userId) {
      throw new UnauthorizedError('Authentication required.');
    }

    if (req.workerProfile) {
      return next();
    }

    const userId = BigInt(req.user.userId);
    const worker = await prisma.workerProfile.findUnique({
      where: { userId },
    });

    if (!worker) {
      throw new NotFoundError(
        'Worker profile not found. Please complete initial onboarding.'
      );
    }

    req.workerProfile = worker;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware that strictly requires the worker profile to be in 'APPROVED' status.
 * Rejects SUSPENDED, REJECTED, and PENDING workers with HTTP 403 Forbidden.
 *
 * Security Invariants:
 * 1. Resolves worker profile via `requireWorkerProfile`.
 * 2. Blocks suspended workers (checks both `approvalStatus === 'SUSPENDED'` and `suspendedAt`).
 * 3. Blocks rejected applications.
 * 4. Blocks pending/under-review applications.
 * 5. Does NOT mutate worker state.
 */
export const requireApprovedWorker = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.workerProfile) {
      await requireWorkerProfile(req, res, (err?: any) => {
        if (err) throw err;
      });
    }

    const worker = req.workerProfile!;

    if (worker.approvalStatus === 'SUSPENDED' || worker.suspendedAt) {
      throw new ForbiddenError(
        'Worker account is suspended. Operational actions are disabled.'
      );
    }

    if (worker.approvalStatus === 'REJECTED') {
      throw new ForbiddenError(
        'Worker application was rejected. Operational actions are disabled.'
      );
    }

    if (worker.approvalStatus !== 'APPROVED') {
      throw new ForbiddenError(
        'Worker onboarding application is under review. Operational actions require approval.'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware that verifies operational readiness for active dispatch and duty status toggles:
 * - Worker is APPROVED and not suspended (via `requireApprovedWorker`).
 * - Underlying User account is ACTIVE (identity consistency check).
 *
 * NOTE on KYC & Operational Rules:
 * In strict compliance with the architecture, this middleware does NOT duplicate or bypass
 * the KYC evaluation or geographic validity rules of `WorkerAvailabilityService`.
 * The existing `WorkerAvailabilityService` remains the final authority for whether
 * a worker can transition to ONLINE state.
 */
export const requireOperationalWorker = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await requireApprovedWorker(req, res, (err?: any) => {
      if (err) throw err;
    });

    // Verify root user account status is ACTIVE
    const userId = BigInt(req.user!.userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true },
    });

    if (!user || user.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError(
        `Operational access blocked: User account status is '${user?.accountStatus || 'UNKNOWN'}'. Account must be ACTIVE.`
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};
