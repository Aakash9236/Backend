import { Request, Response, NextFunction } from 'express';
import { TokenUtil } from '../utils/token.util';
import { UnauthorizedError, ForbiddenError } from '../errors';
import { JwtUserPayload } from '../../modules/auth/auth.types';
import { UserRole } from '../constants';
import { prisma } from '../../config/db.config';

// Extend Express Request type to include authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

/**
 * Middleware that verifies the JWT Bearer access token and validates the active session
 */
export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication token missing or invalid format (Bearer token required).');
    }

    const token = authHeader.split(' ')[1];
    const payload = TokenUtil.verifyAccessToken(token);

    // Validate active session in database (prevents using token after single/all logout)
    try {
      const sessionIdBigInt = BigInt(payload.sessionId);
      const session = await prisma.userSession.findUnique({
        where: { id: sessionIdBigInt },
      });

      if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
        throw new UnauthorizedError('Session has been terminated or expired. Please log in again.');
      }
    } catch (err: any) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Invalid session identifier in access token.');
    }

    // Legacy token handling:
    // Do NOT infer activeRole from roles[0].
    // If activeRole is not present, only permit CUSTOMER context when CUSTOMER is assigned.
    if (!payload.activeRole) {
      if (payload.roles && payload.roles.includes(UserRole.CUSTOMER)) {
        payload.activeRole = UserRole.CUSTOMER;
      }
      // If CUSTOMER is not assigned and activeRole is undefined, leave activeRole undefined.
      // Dedicated active-role guards will reject with safe reauthentication requirement.
    }

    // Attach user payload to request
    req.user = payload;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-Based Access Control (RBAC) middleware: Role Entitlement Guard
 * Verifies that the user holds at least one of the specified roles in their assigned roles array.
 */
export const requireRole = (...allowedRoles: (UserRole | string)[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required.'));
    }

    const userRoles = req.user.roles || [];
    const hasRole = allowedRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      return next(
        new ForbiddenError(
          `Access forbidden: You do not have the required role (${allowedRoles.join(' or ')}) to perform this action.`
        )
      );
    }

    next();
  };
};

/**
 * Active Role Context Guard Middleware
 * Verifies that the current request is operating within the specified active role context.
 * For legacy tokens without activeRole:
 * - Permits CUSTOMER context only when CUSTOMER is held.
 * - Otherwise rejects with 401 Unauthorized requiring token refresh or role switch.
 */
export const requireActiveRole = (...allowedRoles: (UserRole | string)[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required.'));
    }

    const activeRole = req.user.activeRole;
    if (!activeRole) {
      // Legacy token without activeRole:
      if (allowedRoles.includes(UserRole.CUSTOMER) && req.user.roles?.includes(UserRole.CUSTOMER)) {
        req.user.activeRole = UserRole.CUSTOMER;
        return next();
      }
      return next(
        new UnauthorizedError(
          'Active role context is missing from token. Please refresh your token or switch to an active role context.'
        )
      );
    }

    if (!allowedRoles.includes(activeRole)) {
      return next(
        new ForbiddenError(
          `Access forbidden: Action requires active role context (${allowedRoles.join(
            ' or '
          )}), but current active context is '${activeRole}'. Please switch your role context.`
        )
      );
    }

    // Also verify entitlement: user must still hold this role in their assigned roles array
    if (!req.user.roles || !req.user.roles.includes(activeRole)) {
      return next(
        new ForbiddenError(
          `Access forbidden: You no longer hold the assigned role '${activeRole}'.`
        )
      );
    }

    next();
  };
};

/**
 * Shorthand alias for requireRole
 */
export const requireAnyRole = requireRole;

/**
 * Dedicated role guard shortcuts
 */
export const requireCustomer = requireRole(UserRole.CUSTOMER);
export const requirePartner = requireRole(UserRole.PARTNER);
export const requireAdmin = requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN);
export const requireSuperAdmin = requireRole(UserRole.SUPER_ADMIN);
