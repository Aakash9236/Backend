import { Prisma } from '@prisma/client';
import {
  AppError,
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../../../common/errors';

/**
 * Maps PostgreSQL and Prisma database errors to clean, safe domain AppErrors for workers
 */
export function handleWorkerDbError(error: unknown, fallbackMessage = 'Database operation failed'): never {
  if (error instanceof AppError) {
    throw error;
  }

  const err = error as any;
  const message = err?.message || '';
  const code = err?.code || '';

  // 1. PostgreSQL 23505 / Prisma P2002 Unique Constraint Violations
  if (code === '23505' || code === 'P2002' || message.includes('23505') || message.includes('Unique constraint failed')) {
    const target = err?.meta?.target || [];
    const targetStr = Array.isArray(target) ? target.join(', ') : String(target);

    if (
      message.includes('idx_one_pending_invitation_per_partner_worker') ||
      (targetStr.includes('partner_id') && targetStr.includes('invited_mobile'))
    ) {
      throw new ConflictError(
        'A pending invitation already exists from this partner to this worker mobile number.'
      );
    }
    if (
      message.includes('idx_active_worker_partner_affiliation') ||
      (targetStr.includes('worker_id') && targetStr.includes('partner_id'))
    ) {
      throw new ConflictError(
        'An active affiliation already exists between this worker and partner.'
      );
    }
    if (
      message.includes('uq_worker_skill') ||
      message.includes('worker_skills_worker_id_service_category_id_key') ||
      (targetStr.includes('worker_id') && targetStr.includes('service_category_id'))
    ) {
      throw new ConflictError(
        'This skill category is already registered for this worker.'
      );
    }
    if (message.includes('worker_profiles_user_id_key') || targetStr.includes('user_id')) {
      throw new ConflictError('A worker profile is already registered for this user account.');
    }
    if (
      message.includes('invitation_token_hash') ||
      targetStr.includes('invitation_token_hash') ||
      message.includes('worker_invitations_invitation_token_hash_key')
    ) {
      throw new ConflictError('Invitation token hash collision. Please retry.');
    }
    if (message.includes('worker_availability_worker_id_key') || targetStr.includes('worker_id')) {
      throw new ConflictError('Availability record already exists for this worker.');
    }
    throw new ConflictError('A record with the specified unique values already exists.');
  }

  // 2. PostgreSQL 23503 / Prisma P2003 Foreign Key Violations
  if (code === '23503' || code === 'P2003' || message.includes('23503') || message.includes('Foreign key constraint failed')) {
    if (message.includes('fk_worker_document_worker')) {
      throw new ConflictError(
        'Cannot remove worker profile because verification documents are attached.'
      );
    }
    if (message.includes('fk_worker_skill_category')) {
      throw new NotFoundError('Referenced service category does not exist.');
    }
    if (message.includes('fk_worker_affiliation_partner') || message.includes('fk_worker_invitation_partner')) {
      throw new NotFoundError('Referenced partner profile does not exist.');
    }
    if (message.includes('fk_worker_affiliation_worker') || message.includes('fk_worker_skill_worker')) {
      throw new NotFoundError('Referenced worker profile does not exist.');
    }
    if (message.includes('fk_worker_profile_user')) {
      throw new NotFoundError('Referenced user account does not exist.');
    }
    throw new BadRequestError('Referenced entity does not exist or relation constraint violated.');
  }

  // 3. PostgreSQL 23514 / Prisma P2004 Check Constraint Violations
  if (code === '23514' || code === 'P2004' || message.includes('23514') || message.includes('check constraint')) {
    if (message.includes('chk_worker_approval_status')) {
      throw new BadRequestError(
        "Invalid worker approval status. Allowed values: 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'."
      );
    }
    if (message.includes('chk_worker_submission_status')) {
      throw new BadRequestError(
        "Invalid worker submission status. Allowed values: 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED'."
      );
    }
    if (message.includes('chk_worker_type')) {
      throw new BadRequestError(
        "Invalid worker type. Allowed values: 'HELPER', 'TECHNICIAN', 'SPECIALIST'."
      );
    }
    if (message.includes('chk_worker_experience')) {
      throw new BadRequestError('Worker experience years cannot be negative.');
    }
    if (message.includes('chk_worker_skill_experience')) {
      throw new BadRequestError('Skill experience years cannot be negative.');
    }
    if (message.includes('chk_worker_invitation_status')) {
      throw new BadRequestError(
        "Invalid invitation status. Allowed values: 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED'."
      );
    }
    if (message.includes('chk_worker_affiliation_status')) {
      throw new BadRequestError(
        "Invalid affiliation status. Allowed values: 'ACTIVE', 'TERMINATED', 'SUSPENDED'."
      );
    }
    if (message.includes('chk_worker_affiliation_terminated')) {
      throw new BadRequestError(
        'Terminated affiliation must have terminated_at timestamp and valid termination status.'
      );
    }
    if (message.includes('chk_worker_doc_type')) {
      throw new BadRequestError(
        "Invalid worker document type. Allowed values: 'IDENTITY_PROOF', 'PROFILE_PHOTO', 'POLICE_VERIFICATION', 'ADDRESS_PROOF', 'SKILL_CERTIFICATE', 'MEDICAL_FITNESS', 'OTHER'."
      );
    }
    if (message.includes('chk_worker_document_verification_status')) {
      throw new BadRequestError(
        "Invalid document verification status. Allowed values: 'PENDING', 'VERIFIED', 'REJECTED'."
      );
    }
    if (message.includes('chk_worker_skill_verification_status')) {
      throw new BadRequestError(
        "Invalid skill verification status. Allowed values: 'PENDING', 'VERIFIED', 'REJECTED'."
      );
    }
    throw new BadRequestError(`Database validation check failed: ${message}`);
  }

  // Fallback
  throw new BadRequestError(err?.message || fallbackMessage);
}
