import { Router } from 'express';
import multer from 'multer';
import { partnersController } from './partners.controller';
import { requireAuth, validateRequest } from '../../common/middlewares';
import {
  requirePartnerProfile,
  requireActivePartner,
} from './partners.middleware';
import {
  partnerOnboardingSchema,
  updatePartnerProfileSchema,
  addPartnerSkillSchema,
  addPartnerServiceAreaSchema,
} from './partners.validator';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * @openapi
 * /api/v1/partners/onboarding:
 *   post:
 *     summary: Submit Partner Onboarding Application
 *     description: Creates partner profile in PENDING status and assigns PARTNER role while keeping existing roles.
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - legalName
 *             properties:
 *               profileType:
 *                 type: string
 *                 enum: [INDIVIDUAL, BUSINESS]
 *                 default: INDIVIDUAL
 *               legalName:
 *                 type: string
 *               businessName:
 *                 type: string
 *               businessDescription:
 *                 type: string
 *               experienceYears:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Onboarding application submitted.
 */
router.post(
  '/onboarding',
  validateRequest(partnerOnboardingSchema),
  partnersController.onboard
);

/**
 * @openapi
 * /api/v1/partners/profile:
 *   get:
 *     summary: Retrieve Partner Profile
 *     description: Accessible to partners in PENDING, APPROVED, or SUSPENDED status to review account state.
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Partner profile details.
 *       404:
 *         description: Partner profile not found.
 */
router.get('/profile', requirePartnerProfile, partnersController.getProfile);

/**
 * @openapi
 * /api/v1/partners/profile:
 *   patch:
 *     summary: Update Partner Profile Information
 *     description: Permitted for PENDING and APPROVED partners. Denied with HTTP 403 if SUSPENDED or REJECTED.
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               legalName:
 *                 type: string
 *               businessName:
 *                 type: string
 *               businessDescription:
 *                 type: string
 *               experienceYears:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Partner profile updated.
 *       403:
 *         description: Forbidden (Partner is SUSPENDED or REJECTED).
 */
router.patch(
  '/profile',
  requireActivePartner,
  validateRequest(updatePartnerProfileSchema),
  partnersController.updateProfile
);

/**
 * @openapi
 * /api/v1/partners/documents:
 *   post:
 *     summary: Upload KYC Verification Document
 *     description: Permitted during onboarding (PENDING) or resubmission. Denied with HTTP 403 if SUSPENDED or REJECTED.
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - documentType
 *             properties:
 *               documentType:
 *                 type: string
 *                 example: AADHAAR
 *               file:
 *                 type: string
 *                 format: binary
 *               documentStorageKey:
 *                 type: string
 *     responses:
 *       201:
 *         description: Document uploaded.
 *       403:
 *         description: Forbidden (Partner is SUSPENDED or REJECTED).
 */
router.post(
  '/documents',
  requireActivePartner,
  upload.single('file'),
  partnersController.uploadDocument
);

/**
 * @openapi
 * /api/v1/partners/documents:
 *   get:
 *     summary: List Uploaded KYC Documents
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Documents list.
 */
router.get('/documents', requirePartnerProfile, partnersController.getDocuments);

/**
 * @openapi
 * /api/v1/partners/skills:
 *   post:
 *     summary: Add Service Skill to Partner Profile
 *     description: Permitted during onboarding or active operation. Denied with HTTP 403 if SUSPENDED or REJECTED.
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceCategoryId
 *             properties:
 *               serviceCategoryId:
 *                 type: string
 *               experienceYears:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Skill added.
 *       403:
 *         description: Forbidden (SUSPENDED or REJECTED partners cannot manage skills).
 */
router.post(
  '/skills',
  requireActivePartner,
  validateRequest(addPartnerSkillSchema),
  partnersController.addSkill
);

/**
 * @openapi
 * /api/v1/partners/skills:
 *   get:
 *     summary: List Partner Skills
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Partner skills list.
 */
router.get('/skills', requirePartnerProfile, partnersController.getSkills);

/**
 * @openapi
 * /api/v1/partners/service-areas:
 *   post:
 *     summary: Add Operational Service Area
 *     description: Permitted during onboarding or active operation. Denied with HTTP 403 if SUSPENDED or REJECTED.
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cityId
 *             properties:
 *               cityId:
 *                 type: string
 *               areaId:
 *                 type: string
 *               coverageType:
 *                 type: string
 *                 enum: [CITY_WIDE, AREA_SPECIFIC, RADIUS]
 *               serviceRadiusKm:
 *                 type: number
 *     responses:
 *       201:
 *         description: Service area added.
 *       403:
 *         description: Forbidden (SUSPENDED or REJECTED partners cannot manage service areas).
 */
router.post(
  '/service-areas',
  requireActivePartner,
  validateRequest(addPartnerServiceAreaSchema),
  partnersController.addServiceArea
);

/**
 * @openapi
 * /api/v1/partners/service-areas:
 *   get:
 *     summary: List Partner Service Areas
 *     tags:
 *       - Partners
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Service areas list.
 */
router.get('/service-areas', requirePartnerProfile, partnersController.getServiceAreas);

export const partnerRoutes = router;
