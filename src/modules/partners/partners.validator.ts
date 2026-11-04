import { z } from 'zod';

export const partnerOnboardingBodySchema = z
  .object({
    profileType: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
    legalName: z
      .string({ required_error: 'Legal name is required' })
      .trim()
      .min(2, 'Legal name must be at least 2 characters')
      .max(100),
    businessName: z.string().trim().max(150).optional().nullable(),
    businessDescription: z.string().trim().max(1000).optional().nullable(),
    experienceYears: z
      .number()
      .int()
      .min(0, 'Experience must be 0 or greater')
      .max(60, 'Experience years must be <= 60')
      .default(0),
  })
  .strict();

export const partnerOnboardingSchema = {
  body: partnerOnboardingBodySchema,
};

export const updatePartnerProfileBodySchema = z
  .object({
    legalName: z.string().trim().min(2).max(100).optional(),
    businessName: z.string().trim().max(150).optional().nullable(),
    businessDescription: z.string().trim().max(1000).optional().nullable(),
    experienceYears: z.number().int().min(0).max(60).optional(),
  })
  .strict();

export const updatePartnerProfileSchema = {
  body: updatePartnerProfileBodySchema,
};

export const addPartnerSkillBodySchema = z
  .object({
    serviceCategoryId: z.union([z.string(), z.number()], {
      required_error: 'Service category ID is required',
    }),
    experienceYears: z
      .number()
      .int()
      .min(0, 'Experience must be >= 0')
      .max(60)
      .default(0),
  })
  .strict();

export const addPartnerSkillSchema = {
  body: addPartnerSkillBodySchema,
};

export const addPartnerServiceAreaBodySchema = z
  .object({
    cityId: z.union([z.string(), z.number()], {
      required_error: 'City ID is required',
    }),
    areaId: z.union([z.string(), z.number()]).optional().nullable(),
    coverageType: z.enum(['CITY', 'AREA']).default('CITY'),
    serviceRadiusKm: z
      .number()
      .min(0.5, 'Radius must be at least 0.5 km')
      .max(200, 'Radius cannot exceed 200 km')
      .optional()
      .nullable(),
  })
  .strict();

export const addPartnerServiceAreaSchema = {
  body: addPartnerServiceAreaBodySchema,
};

export const partnerDocumentBodySchema = z.object({
  documentType: z
    .string({ required_error: 'Document type is required' })
    .trim()
    .min(2)
    .max(50),
  documentStorageKey: z.string().trim().optional(),
});

export const partnerDocumentSchema = {
  body: partnerDocumentBodySchema,
};
