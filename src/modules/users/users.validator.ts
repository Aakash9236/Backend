import { z } from 'zod';

export const updateUserBodySchema = z
  .object({
    email: z.string().trim().email('Invalid email address format').optional(),
  })
  .strict();

export const updateUserSchema = {
  body: updateUserBodySchema,
};

export const createAddressBodySchema = z
  .object({
    cityId: z.union([z.string(), z.number()], {
      required_error: 'City ID is required',
    }),
    areaId: z.union([z.string(), z.number()]).optional().nullable(),
    addressType: z.enum(['HOME', 'WORK', 'OTHER']).default('HOME'),
    addressLine1: z
      .string({ required_error: 'Address line 1 is required' })
      .trim()
      .min(3, 'Address line 1 must be at least 3 characters')
      .max(255),
    addressLine2: z.string().trim().max(255).optional().nullable(),
    landmark: z.string().trim().max(255).optional().nullable(),
    postalCode: z
      .string({ required_error: 'Postal code is required' })
      .trim()
      .regex(/^\d{6}$/, 'Postal code must be a 6-digit PIN code'),
    latitude: z
      .number({ required_error: 'Latitude is required' })
      .min(-90, 'Latitude must be >= -90')
      .max(90, 'Latitude must be <= 90'),
    longitude: z
      .number({ required_error: 'Longitude is required' })
      .min(-180, 'Longitude must be >= -180')
      .max(180, 'Longitude must be <= 180'),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const createAddressSchema = {
  body: createAddressBodySchema,
};

export const updateAddressBodySchema = z
  .object({
    cityId: z.union([z.string(), z.number()]).optional(),
    areaId: z.union([z.string(), z.number()]).optional().nullable(),
    addressType: z.enum(['HOME', 'WORK', 'OTHER']).optional(),
    addressLine1: z.string().trim().min(3).max(255).optional(),
    addressLine2: z.string().trim().max(255).optional().nullable(),
    landmark: z.string().trim().max(255).optional().nullable(),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Postal code must be a 6-digit PIN code')
      .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const updateAddressSchema = {
  body: updateAddressBodySchema,
};

