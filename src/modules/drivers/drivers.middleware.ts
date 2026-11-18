import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/db.config';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/errors';
import { DriverProfile } from '@prisma/client';
import { DateUtil } from '../../common/utils/date.util';

// Extend Express Request type to include driverProfile
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      driverProfile?: DriverProfile;
    }
  }
}

/**
 * Middleware that loads the DriverProfile for the authenticated user.
 * Attaches the profile to `req.driverProfile`.
 */
export const requireDriverProfile = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user || !req.user.userId) {
      throw new UnauthorizedError('Authentication required.');
    }

    const userId = BigInt(req.user.userId);
    const driver = await prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (!driver) {
      throw new NotFoundError(
        'Driver profile not found. Please submit an onboarding application first.'
      );
    }

    req.driverProfile = driver;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware that strictly requires the driver profile to be in 'APPROVED' status.
 * Rejects SUSPENDED, REJECTED, and PENDING drivers with HTTP 403 Forbidden.
 */
export const requireApprovedDriver = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.driverProfile) {
      await requireDriverProfile(req, res, (err?: any) => {
        if (err) throw err;
      });
    }

    const driver = req.driverProfile!;

    if (driver.approvalStatus === 'SUSPENDED' || driver.suspendedAt) {
      throw new ForbiddenError(
        'Driver account is suspended. Operational actions are disabled.'
      );
    }

    if (driver.approvalStatus === 'REJECTED') {
      throw new ForbiddenError(
        'Driver application was rejected. Operational actions are disabled.'
      );
    }

    if (driver.approvalStatus !== 'APPROVED') {
      throw new ForbiddenError(
        'Driver onboarding application is under review. Operational actions require approval.'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware that checks operational readiness:
 * - Driver is APPROVED
 * - User account is ACTIVE
 * - Driver is not suspended
 * - Driving licence and mandatory documents are not expired (Asia/Kolkata calendar day)
 */
export const requireOperationalDriver = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await requireApprovedDriver(req, res, (err?: any) => {
      if (err) throw err;
    });

    const driver = req.driverProfile!;

    // Check document expiry
    const docs = await prisma.driverDocument.findMany({
      where: {
        driverId: driver.id,
        verificationStatus: 'VERIFIED',
      },
    });

    const hasExpiredDoc = docs.some((d) => d.expiryDate && DateUtil.evaluateCalendarExpiry(d.expiryDate).isExpired);
    if (hasExpiredDoc) {
      throw new ForbiddenError(
        'Operational access blocked: Mandatory driver document has expired. Please upload a renewal.'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};
