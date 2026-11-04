import { z } from 'zod';

export const customerProfileBodySchema = z
  .object({
    firstName: z
      .string({ required_error: 'First name is required' })
      .trim()
      .min(2, 'First name must be at least 2 characters')
      .max(50),
    lastName: z.string().trim().max(50).optional().nullable(),
    dateOfBirth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
      .optional()
      .nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
    profileImageUrl: z.string().trim().optional().nullable(),
  })
  .strict();

export const customerProfileSchema = {
  body: customerProfileBodySchema,
};

export const updateCustomerProfileBodySchema = customerProfileBodySchema.partial();

export const updateCustomerProfileSchema = {
  body: updateCustomerProfileBodySchema,
};

