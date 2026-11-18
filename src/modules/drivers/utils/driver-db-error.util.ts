import { Prisma } from '@prisma/client';
import {
  AppError,
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../../../common/errors';

/**
 * Maps PostgreSQL and Prisma database errors to clean, safe domain AppErrors
 */
export function handleDriverDbError(error: unknown, fallbackMessage = 'Database operation failed'): never {
  if (error instanceof AppError) {
    throw error;
  }

  const err = error as any;
  const message = err?.message || '';
  const code = err?.code || '';

  // 1. PostgreSQL 23P01 / GiST Exclusion Constraint Violations (Overlapping Assignments)
  if (code === '23P01' || message.includes('23P01') || message.includes('exclusion_violation')) {
    if (message.includes('ex_no_overlapping_driver_assignments')) {
      throw new ConflictError(
        'Driver already has an active or scheduled vehicle assignment during this time window.'
      );
    }
    if (message.includes('ex_no_overlapping_vehicle_assignments')) {
      throw new ConflictError(
        'Vehicle already has an active or scheduled driver assignment during this time window.'
      );
    }
    throw new ConflictError(
      'Assignment schedule conflict: Overlapping shift detected for the specified time window.'
    );
  }

  // 2. PostgreSQL 23505 / Prisma P2002 Unique Constraint Violations
  if (code === '23505' || code === 'P2002' || message.includes('23505') || message.includes('Unique constraint failed')) {
    const target = err?.meta?.target || [];
    const targetStr = Array.isArray(target) ? target.join(', ') : String(target);

    if (message.includes('idx_one_pending_invitation_per_partner_driver') || targetStr.includes('invited_mobile')) {
      throw new ConflictError(
        'A pending invitation already exists from this partner to this driver mobile number.'
      );
    }
    if (message.includes('idx_active_driver_partner_affiliation') || targetStr.includes('driver_id') && targetStr.includes('partner_id')) {
      throw new ConflictError(
        'An active affiliation already exists between this driver and partner.'
      );
    }
    if (message.includes('driver_profiles_user_id_key') || targetStr.includes('user_id')) {
      throw new ConflictError('A driver profile is already registered for this user account.');
    }
    if (message.includes('invitation_token') || targetStr.includes('invitation_token')) {
      throw new ConflictError('Invitation token collision. Please retry with a new invitation.');
    }
    throw new ConflictError('A record with the specified unique values already exists.');
  }

  // 3. PostgreSQL 23503 / Prisma P2003 Foreign Key Violations
  if (code === '23503' || code === 'P2003' || message.includes('23503') || message.includes('Foreign key constraint failed')) {
    if (message.includes('fk_driver_document_driver')) {
      throw new ConflictError(
        'Cannot remove driver profile because verification documents are attached.'
      );
    }
    if (message.includes('fk_dva_driver')) {
      throw new NotFoundError('Referenced driver profile does not exist.');
    }
    if (message.includes('fk_dva_vehicle')) {
      throw new NotFoundError('Referenced vehicle does not exist.');
    }
    if (message.includes('fk_dva_partner') || message.includes('fk_driver_invitation_partner')) {
      throw new NotFoundError('Referenced partner profile does not exist.');
    }
    throw new BadRequestError('Referenced entity does not exist or relation constraint violated.');
  }

  // 4. PostgreSQL 23514 / Prisma P2004 Check Constraint Violations
  if (code === '23514' || code === 'P2004' || message.includes('23514') || message.includes('check constraint')) {
    if (message.includes('chk_dva_time_range')) {
      throw new BadRequestError('Assignment end time must be strictly after start time.');
    }
    if (message.includes('chk_dva_actual_time')) {
      throw new BadRequestError('Actual shift end time must be strictly after actual start time.');
    }
    if (message.includes('chk_dva_status')) {
      throw new BadRequestError(
        "Invalid assignment status. Allowed values: 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'."
      );
    }
    if (message.includes('chk_driver_approval_status')) {
      throw new BadRequestError(
        "Invalid driver approval status. Allowed values: 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'."
      );
    }
    if (message.includes('chk_driver_submission_status')) {
      throw new BadRequestError(
        "Invalid driver submission status. Allowed values: 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'."
      );
    }
    if (message.includes('chk_driver_doc_status')) {
      throw new BadRequestError(
        "Invalid document verification status. Allowed values: 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'."
      );
    }
    if (message.includes('chk_driver_doc_type')) {
      throw new BadRequestError('Invalid or unsupported driver document type.');
    }
    if (message.includes('chk_driver_invitation_status')) {
      throw new BadRequestError(
        "Invalid invitation status. Allowed values: 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED'."
      );
    }
    if (message.includes('chk_driver_affiliation_status')) {
      throw new BadRequestError(
        "Invalid affiliation status. Allowed values: 'ACTIVE', 'INACTIVE', 'TERMINATED'."
      );
    }
    if (message.includes('chk_active_affiliation_terminated_at')) {
      throw new BadRequestError('Active affiliation cannot have a termination timestamp.');
    }
    throw new BadRequestError('Data validation check constraint violated.');
  }

  // Fallback safe error
  throw new BadRequestError(fallbackMessage);
}

