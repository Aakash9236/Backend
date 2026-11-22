import { z } from 'zod';

export const phoneRegex = /^\+91[6-9]\d{9}$/;

// ============================================================================
// A. Worker Profile Schemas
// ============================================================================

export const updateWorkerProfileSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(2, 'First name must be at least 2 characters')
      .max(100, 'First name cannot exceed 100 characters')
      .optional(),
    lastName: z.string().trim().max(100, 'Last name cannot exceed 100 characters').optional().nullable(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
      .optional()
      .nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER'], {
      errorMap: () => ({ message: "Gender must be one of 'MALE', 'FEMALE', or 'OTHER'" }),
    }).optional().nullable(),
    bio: z.string().trim().max(1000, 'Bio cannot exceed 1000 characters').optional().nullable(),
    experienceYears: z
      .number({ invalid_type_error: 'Experience years must be a number' })
      .int('Experience years must be an integer')
      .min(0, 'Experience years must be >= 0')
      .max(60, 'Experience years cannot exceed 60')
      .optional(),
    workerType: z.enum(['HELPER', 'TECHNICIAN', 'SPECIALIST'], {
      errorMap: () => ({ message: "Worker type must be one of 'HELPER', 'TECHNICIAN', or 'SPECIALIST'" }),
    }).optional(),
    primaryCityId: z
      .union([z.string().trim().min(1), z.number().int().positive()])
      .optional()
      .nullable(),
  })
  .strict(); // Rejects client-supplied privileged fields (e.g. userId, approvalStatus, isSuspended)

export type UpdateWorkerProfileDto = z.infer<typeof updateWorkerProfileSchema>;

// ============================================================================
// B. Worker Document Schemas
// ============================================================================

export const uploadWorkerDocumentSchema = z
  .object({
    documentType: z.enum(
      [
        'IDENTITY_PROOF',
        'PROFILE_PHOTO',
        'POLICE_VERIFICATION',
        'ADDRESS_PROOF',
        'SKILL_CERTIFICATE',
        'MEDICAL_FITNESS',
        'OTHER',
      ],
      {
        errorMap: () => ({
          message:
            "Invalid document type. Allowed types: 'IDENTITY_PROOF', 'PROFILE_PHOTO', 'POLICE_VERIFICATION', 'ADDRESS_PROOF', 'SKILL_CERTIFICATE', 'MEDICAL_FITNESS', 'OTHER'",
        }),
      }
    ),
    documentNumber: z.string().trim().max(100, 'Document number cannot exceed 100 characters').optional().nullable(),
    expiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
      .optional()
      .nullable(),
  })
  .strict();

export type UploadWorkerDocumentDto = z.infer<typeof uploadWorkerDocumentSchema>;

// ============================================================================
// C. Worker Skill Schemas
// ============================================================================

export const addWorkerSkillSchema = z
  .object({
    serviceCategoryId: z.union([
      z.string().trim().min(1, 'Service category ID is required'),
      z.number().int().positive('Service category ID must be a positive integer'),
    ]),
    experienceYears: z
      .number({ invalid_type_error: 'Experience years must be a number' })
      .int('Experience years must be an integer')
      .min(0, 'Experience years must be >= 0')
      .max(60, 'Experience years cannot exceed 60')
      .optional(),
  })
  .strict();

export type AddWorkerSkillDto = z.infer<typeof addWorkerSkillSchema>;

// ============================================================================
// D. Worker Invitation Schemas
// ============================================================================

export const createWorkerInvitationSchema = z
  .object({
    invitedMobile: z
      .string()
      .trim()
      .min(1, 'Invited mobile number is required')
      .regex(phoneRegex, 'Invalid Indian mobile number format (+91XXXXXXXXXX)'),
    workerName: z.string().trim().max(150, 'Worker name cannot exceed 150 characters').optional().nullable(),
    proposedRole: z.string().trim().max(50, 'Proposed role cannot exceed 50 characters').optional().nullable(),
    notes: z.string().trim().max(500, 'Notes cannot exceed 500 characters').optional().nullable(),
  })
  .strict();

export type CreateWorkerInvitationDto = z.infer<typeof createWorkerInvitationSchema>;

export const revokeWorkerInvitationSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Revocation reason is mandatory')
      .max(500, 'Revocation reason cannot exceed 500 characters'),
  })
  .strict();

export type RevokeWorkerInvitationDto = z.infer<typeof revokeWorkerInvitationSchema>;

export const acceptWorkerInvitationSchema = z
  .object({
    notes: z.string().trim().max(500, 'Notes cannot exceed 500 characters').optional().nullable(),
  })
  .strict();

export type AcceptWorkerInvitationDto = z.infer<typeof acceptWorkerInvitationSchema>;

export const rejectWorkerInvitationSchema = z
  .object({
    reason: z.string().trim().max(500, 'Rejection reason cannot exceed 500 characters').optional().nullable(),
  })
  .strict();

export type RejectWorkerInvitationDto = z.infer<typeof rejectWorkerInvitationSchema>;

export const lookupWorkerInvitationSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(16, 'Invitation token must be at least 16 characters')
      .max(128, 'Invitation token cannot exceed 128 characters'),
  })
  .strict();

export type LookupWorkerInvitationDto = z.infer<typeof lookupWorkerInvitationSchema>;

// ============================================================================
// E. Worker Affiliation Schemas
// ============================================================================

export const terminateAffiliationSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Termination reason is mandatory')
      .max(500, 'Termination reason cannot exceed 500 characters'),
  })
  .strict();

export type TerminateAffiliationDto = z.infer<typeof terminateAffiliationSchema>;

// ============================================================================
// F. Worker Availability & Heartbeat Schemas
// ============================================================================

export const updateDutyStatusSchema = z
  .object({
    isOnline: z.boolean({ required_error: 'isOnline status is required' }),
    latitude: z
      .number({ invalid_type_error: 'Latitude must be a valid number' })
      .min(-90, 'Latitude must be between -90 and 90')
      .max(90, 'Latitude must be between -90 and 90')
      .optional()
      .nullable(),
    longitude: z
      .number({ invalid_type_error: 'Longitude must be a valid number' })
      .min(-180, 'Longitude must be between -180 and 180')
      .max(180, 'Longitude must be between -180 and 180')
      .optional()
      .nullable(),
  })
  .strict();

export type UpdateDutyStatusDto = z.infer<typeof updateDutyStatusSchema>;

export const workerHeartbeatSchema = z
  .object({
    latitude: z
      .number({ invalid_type_error: 'Latitude must be a valid number' })
      .min(-90, 'Latitude must be between -90 and 90')
      .max(90, 'Latitude must be between -90 and 90')
      .optional()
      .nullable(),
    longitude: z
      .number({ invalid_type_error: 'Longitude must be a valid number' })
      .min(-180, 'Longitude must be between -180 and 180')
      .max(180, 'Longitude must be between -180 and 180')
      .optional()
      .nullable(),
  })
  .strict();

export type WorkerHeartbeatDto = z.infer<typeof workerHeartbeatSchema>;

// ============================================================================
// G. Admin Worker Governance Schemas
// ============================================================================

export const adminRejectWorkerSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Worker rejection reason is mandatory')
      .max(1000, 'Worker rejection reason cannot exceed 1000 characters'),
  })
  .strict();

export type AdminRejectWorkerDto = z.infer<typeof adminRejectWorkerSchema>;

export const adminSuspendWorkerSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Worker suspension reason is mandatory')
      .max(1000, 'Worker suspension reason cannot exceed 1000 characters'),
  })
  .strict();

export type AdminSuspendWorkerDto = z.infer<typeof adminSuspendWorkerSchema>;

export const adminRejectDocumentSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Document rejection reason is mandatory')
      .max(1000, 'Document rejection reason cannot exceed 1000 characters'),
  })
  .strict();

export type AdminRejectDocumentDto = z.infer<typeof adminRejectDocumentSchema>;

export const adminRejectSkillSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Skill rejection reason is mandatory')
      .max(1000, 'Skill rejection reason cannot exceed 1000 characters'),
  })
  .strict();

export type AdminRejectSkillDto = z.infer<typeof adminRejectSkillSchema>;

// ============================================================================
// H. Query & Filter Schemas
// ============================================================================

export const paginationQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val !== undefined && val !== null && val !== '' ? parseInt(String(val), 10) : 1),
    z.number().int('Page must be an integer').positive('Page must be a positive integer').default(1)
  ),
  limit: z.preprocess(
    (val) => (val !== undefined && val !== null && val !== '' ? parseInt(String(val), 10) : 20),
    z
      .number()
      .int('Limit must be an integer')
      .positive('Limit must be a positive integer')
      .max(100, 'Limit cannot exceed 100')
      .default(20)
  ),
});

export type PaginationQueryDto = z.infer<typeof paginationQuerySchema>;

export const workerApplicationFilterQuerySchema = paginationQuerySchema.extend({
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  submissionStatus: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  workerType: z.enum(['HELPER', 'TECHNICIAN', 'SPECIALIST']).optional(),
  primaryCityId: z.preprocess(
    (val) => (val !== undefined && val !== null && val !== '' ? String(val).trim() : undefined),
    z.string().optional()
  ),
  search: z.string().trim().max(100).optional(),
  isActive: z.preprocess((val) => {
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return undefined;
  }, z.boolean().optional()),
});

export type WorkerApplicationFilterQueryDto = z.infer<typeof workerApplicationFilterQuerySchema>;

export const workerInvitationFilterQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED']).optional(),
});

export type WorkerInvitationFilterQueryDto = z.infer<typeof workerInvitationFilterQuerySchema>;
