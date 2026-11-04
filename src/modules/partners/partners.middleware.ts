import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/db.config';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/errors';
import { PartnerProfile } from '@prisma/client';

// Extend Express Request type to include partner profile
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: PartnerProfile;
    }
  }
}

/**
 * Middleware that loads the PartnerProfile for the authenticated user.
 * Attaches the profile to `req.partner`.
 */
export const requirePartnerProfile = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user || !req.user.userId) {
      throw new UnauthorizedError('Authentication required.');
    }

    const userId = BigInt(req.user.userId);
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new NotFoundError(
        'Partner profile not found. Please submit an onboarding application first.'
      );
    }

    req.partner = partner;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware for operational partner actions (skills, service areas, documents, profile updates).
 * Allows PENDING (onboarding) and APPROVED partners.
 * Strictly blocks SUSPENDED and REJECTED partners with HTTP 403 Forbidden.
 */
export const requireActivePartner = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.partner) {
      await requirePartnerProfile(req, res, (err?: any) => {
        if (err) throw err;
      });
    }

    const partner = req.partner!;

    if (partner.approvalStatus === 'SUSPENDED') {
      throw new ForbiddenError(
        'Partner account is suspended. Operational actions are disabled.'
      );
    }

    if (partner.approvalStatus === 'REJECTED') {
      throw new ForbiddenError(
        'Partner application was rejected. Operational actions are disabled.'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware that strictly requires partner to be in 'APPROVED' status.
 * Rejects SUSPENDED, REJECTED, and PENDING partners with HTTP 403 Forbidden.
 * Used for actions exclusive to fully approved partners.
 */
export const requireApprovedPartner = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.partner) {
      await requirePartnerProfile(req, res, (err?: any) => {
        if (err) throw err;
      });
    }

    const partner = req.partner!;

    if (partner.approvalStatus === 'SUSPENDED') {
      throw new ForbiddenError(
        'Partner account is suspended. Operational actions are disabled.'
      );
    }

    if (partner.approvalStatus === 'REJECTED') {
      throw new ForbiddenError(
        'Partner application was rejected. Operational actions are disabled.'
      );
    }

    if (partner.approvalStatus !== 'APPROVED') {
      throw new ForbiddenError(
        `Partner application is in '${partner.approvalStatus}' status. This action requires an APPROVED partner profile.`
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Alias for onboarding/active partner middleware
 */
export const requireOperationalPartner = requireActivePartner;
export const requireOnboardingPartner = requireActivePartner;
