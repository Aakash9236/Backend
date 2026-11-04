import { z } from 'zod';

export const registerVehicleBodySchema = z
  .object({
    vehicleTypeId: z
      .string()
      .trim()
      .min(1, 'Vehicle type ID is required')
      .regex(/^\d+$/, 'Vehicle type ID must be a numeric identifier'),
    registrationNumber: z
      .string()
      .trim()
      .min(3, 'Registration number must be at least 3 characters')
      .max(20, 'Registration number cannot exceed 20 characters'),
    make: z.string().trim().max(100).optional(),
    model: z.string().trim().max(100).optional(),
    manufacturingYear: z
      .number()
      .int()
      .min(1980, 'Manufacturing year cannot be before 1980')
      .max(new Date().getFullYear() + 1, 'Manufacturing year cannot be in the future')
      .optional(),
    rcNumber: z.string().trim().max(100).optional(),
    ownershipType: z.enum(['OWNER', 'LEASED', 'AUTHORIZED_REPRESENTATIVE'], {
      errorMap: () => ({
        message:
          'Ownership type must be one of: OWNER, LEASED, AUTHORIZED_REPRESENTATIVE',
      }),
    }),
    ownerName: z.string().trim().max(150).optional(),
  })
  .refine(
    (data) => {
      if (data.ownershipType !== 'OWNER' && (!data.ownerName || data.ownerName.trim().length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: 'Owner name is mandatory when ownership type is LEASED or AUTHORIZED_REPRESENTATIVE',
      path: ['ownerName'],
    }
  );

export const registerVehicleSchema = {
  body: registerVehicleBodySchema,
};

export const updateVehicleBodySchema = z.object({
  make: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  manufacturingYear: z
    .number()
    .int()
    .min(1980)
    .max(new Date().getFullYear() + 1)
    .optional(),
  rcNumber: z.string().trim().max(100).optional(),
});

export const updateVehicleSchema = {
  body: updateVehicleBodySchema,
};

export const uploadVehicleDocumentBodySchema = z.object({
  documentType: z.enum(
    [
      'RC',
      'INSURANCE',
      'FITNESS',
      'POLLUTION_PUC',
      'COMMERCIAL_PERMIT',
      'OWNER_AUTHORIZATION',
      'LEASE_AGREEMENT',
      'OTHER',
    ],
    {
      errorMap: () => ({
        message:
          'Invalid document type. Allowed types: RC, INSURANCE, FITNESS, POLLUTION_PUC, COMMERCIAL_PERMIT, OWNER_AUTHORIZATION, LEASE_AGREEMENT, OTHER',
      }),
    }
  ),
  expiryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
    .optional(),
  documentStorageKey: z.string().trim().optional(),
});

export const uploadVehicleDocumentSchema = {
  body: uploadVehicleDocumentBodySchema,
};

export const transferVehicleBodySchema = z.object({
  targetPartnerId: z
    .string()
    .trim()
    .min(1, 'Target partner ID is required')
    .regex(/^\d+$/, 'Target partner ID must be numeric'),
  transferReason: z
    .string()
    .trim()
    .min(5, 'Transfer reason must be at least 5 characters'),
  newOwnershipType: z
    .enum(['OWNER', 'LEASED', 'AUTHORIZED_REPRESENTATIVE'])
    .optional(),
  newOwnerName: z.string().trim().max(150).optional(),
});

export const transferVehicleSchema = {
  body: transferVehicleBodySchema,
};

export const suspendVehicleBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Suspension reason is mandatory and must be at least 3 characters'),
});

export const suspendVehicleSchema = {
  body: suspendVehicleBodySchema,
};

export const rejectVehicleBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Rejection reason is mandatory and must be at least 3 characters'),
});

export const rejectVehicleSchema = {
  body: rejectVehicleBodySchema,
};

export const rejectVehicleDocumentBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Rejection reason is mandatory and must be at least 3 characters'),
});

export const rejectVehicleDocumentSchema = {
  body: rejectVehicleDocumentBodySchema,
};
