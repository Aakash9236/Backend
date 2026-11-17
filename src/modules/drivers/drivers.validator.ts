import { z } from 'zod';

export const phoneRegex = /^\+91[6-9]\d{9}$/;

// ============================================================================
// Driver Profile Schemas
// ============================================================================

export const updateDriverProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100).optional(),
  lastName: z.string().trim().max(100).optional().nullable(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  bio: z.string().trim().max(500).optional().nullable(),
  experienceYears: z.number().int().min(0, 'Experience must be >= 0').max(60).optional(),
  licenceNumber: z.string().trim().min(3).max(50).optional().nullable(),
  licenceClasses: z.array(z.string().trim().min(1)).optional(),
  licenceExpiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Licence expiry date must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
  issuingAuthority: z.string().trim().max(100).optional().nullable(),
});

// ============================================================================
// Driver Document Schemas
// ============================================================================

export const uploadDriverDocumentSchema = z.object({
  documentType: z.enum([
    'DRIVING_LICENCE',
    'PROFILE_PHOTO',
    'IDENTITY_PROOF',
    'POLICE_VERIFICATION',
    'MEDICAL_FITNESS',
    'ADDRESS_PROOF',
  ]),
  documentNumber: z.string().trim().max(100).optional().nullable(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
  documentStorageKey: z.string().trim().optional(),
});

// ============================================================================
// Driver Invitation Schemas
// ============================================================================

export const createDriverInvitationSchema = z.object({
  invitedMobile: z
    .string()
    .trim()
    .regex(phoneRegex, 'Invalid Indian mobile number format (+91XXXXXXXXXX)'),
  driverName: z.string().trim().max(150).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const revokeDriverInvitationSchema = z.object({
  reason: z.string().trim().min(1, 'Revocation reason is mandatory').max(500),
});

export const rejectDriverInvitationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// ============================================================================
// Driver Affiliation Schemas
// ============================================================================

export const terminateAffiliationSchema = z.object({
  reason: z.string().trim().min(1, 'Termination reason is mandatory').max(500),
});

// ============================================================================
// Driver Assignment & Shift Lifecycle Schemas
// ============================================================================

export const scheduleAssignmentSchema = z.object({
  driverId: z.union([z.string().trim().min(1), z.number().int().positive()]),
  vehicleId: z.union([z.string().trim().min(1), z.number().int().positive()]),
  startTime: z.string().datetime({ message: 'startTime must be a valid ISO-8601 timestamp' }),
  endTime: z.string().datetime({ message: 'endTime must be a valid ISO-8601 timestamp' }).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const startShiftSchema = z.object({
  confirmVehiclePossession: z.boolean().optional(),
  initialOdometerReading: z.number().positive().optional(),
});

export const completeShiftSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

export const cancelAssignmentSchema = z.object({
  reason: z.string().trim().min(1, 'Cancellation reason is mandatory').max(500),
});

export const approveCancellationSchema = z.object({
  driverCancellationReason: z.string().trim().min(1, 'Driver cancellation reason is required').max(500),
  ownerApprovalNotes: z.string().trim().max(500).optional(),
});

export const updateDutyStatusSchema = z.object({
  isOnline: z.boolean(),
});

export const driverHeartbeatSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// ============================================================================
// Admin Verification Schemas
// ============================================================================

export const rejectDriverDocumentSchema = z.object({
  reason: z.string().trim().min(1, 'Rejection reason is mandatory').max(500),
});

export const approveDriverSchema = z.object({
  jurisdiction: z.string().trim().max(50).optional(),
  vehicleTypeCode: z.string().trim().max(50).optional(),
});

export const rejectDriverSchema = z.object({
  reason: z.string().trim().min(1, 'Rejection reason is mandatory').max(500),
});

export const suspendDriverSchema = z.object({
  reason: z.string().trim().min(1, 'Suspension reason is mandatory').max(500),
});
