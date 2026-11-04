import { z } from 'zod';

export const rejectionReasonBodySchema = z
  .object({
    reason: z
      .string({ required_error: 'Rejection reason is required' })
      .trim()
      .min(5, 'Rejection reason must be at least 5 characters')
      .max(500),
  })
  .strict();

export const rejectionReasonSchema = {
  body: rejectionReasonBodySchema,
};

export const suspensionReasonBodySchema = z
  .object({
    reason: z
      .string({ required_error: 'Suspension reason is required' })
      .trim()
      .min(5, 'Suspension reason must be at least 5 characters')
      .max(500),
  })
  .strict();

export const suspensionReasonSchema = {
  body: suspensionReasonBodySchema,
};

export const assignRoleBodySchema = z
  .object({
    role: z
      .string({ required_error: 'Role is required' })
      .trim()
      .min(1, 'Role cannot be empty'),
  })
  .strict();

export const assignRoleSchema = {
  body: assignRoleBodySchema,
};


