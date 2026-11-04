import { Router } from 'express';
import multer from 'multer';
import { vehicleController } from './vehicles.controller';
import {
  requireAuth,
  requireActiveRole,
  validateRequest,
} from '../../common/middlewares';
import { UserRole } from '../../common/constants';
import {
  registerVehicleSchema,
  updateVehicleSchema,
  uploadVehicleDocumentSchema,
} from './vehicles.validator';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const router = Router();

/**
 * @openapi
 * /api/v1/partners/vehicles/types:
 *   get:
 *     summary: List Commercial Vehicle Types
 *     description: Retrieve active commercial vehicle types with load capacities, volume dimensions, and baseline rates.
 *     tags:
 *       - Vehicles
 *     parameters:
 *       - in: query
 *         name: serviceCategoryId
 *         schema:
 *           type: string
 *         description: Optional category ID filter
 *     responses:
 *       200:
 *         description: List of vehicle types
 */
router.get('/types', vehicleController.getVehicleTypes);

// All fleet management endpoints require authentication and active PARTNER context
router.use(requireAuth, requireActiveRole(UserRole.PARTNER));

/**
 * @openapi
 * /api/v1/partners/vehicles:
 *   post:
 *     summary: Register a Vehicle into Partner Fleet
 *     description: Register a vehicle with ownership declaration (OWNER, LEASED, AUTHORIZED_REPRESENTATIVE).
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vehicleTypeId
 *               - registrationNumber
 *               - ownershipType
 *             properties:
 *               vehicleTypeId:
 *                 type: string
 *               registrationNumber:
 *                 type: string
 *               make:
 *                 type: string
 *               model:
 *                 type: string
 *               manufacturingYear:
 *                 type: integer
 *               rcNumber:
 *                 type: string
 *               ownershipType:
 *                 type: string
 *                 enum: [OWNER, LEASED, AUTHORIZED_REPRESENTATIVE]
 *               ownerName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Vehicle registered successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Vehicle already actively registered
 */
router.post('/', validateRequest(registerVehicleSchema), vehicleController.registerVehicle);

/**
 * @openapi
 * /api/v1/partners/vehicles:
 *   get:
 *     summary: List Partner's Vehicles
 *     description: List all vehicles in the authenticated partner's fleet with operational eligibility.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Fleet list
 */
router.get('/', vehicleController.getPartnerVehicles);

/**
 * @openapi
 * /api/v1/partners/vehicles/{id}:
 *   get:
 *     summary: Get Vehicle Details
 *     description: Retrieve vehicle details, ownership metadata, and document expiry warnings.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vehicle details
 *       404:
 *         description: Vehicle not found
 */
router.get('/:id', vehicleController.getPartnerVehicleById);

/**
 * @openapi
 * /api/v1/partners/vehicles/{id}:
 *   patch:
 *     summary: Update Vehicle Metadata
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               make:
 *                 type: string
 *               model:
 *                 type: string
 *               manufacturingYear:
 *                 type: integer
 *               rcNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vehicle updated successfully
 */
router.patch('/:id', validateRequest(updateVehicleSchema), vehicleController.updateVehicle);

/**
 * @openapi
 * /api/v1/partners/vehicles/{id}/primary:
 *   patch:
 *     summary: Set Primary Vehicle
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Primary vehicle updated
 */
router.patch('/:id/primary', vehicleController.setPrimaryVehicle);

/**
 * @openapi
 * /api/v1/partners/vehicles/{id}/status:
 *   patch:
 *     summary: Partner Toggle Vehicle Active Status
 *     description: Toggle active state of vehicle for maintenance or downtime.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isActive
 *             properties:
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Status updated
 */
router.patch('/:id/status', vehicleController.setVehicleActiveStatus);

/**
 * @openapi
 * /api/v1/partners/vehicles/{id}/documents:
 *   post:
 *     summary: Upload Vehicle KYC Document
 *     description: Uploads document with immutable replacement history.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *                 enum: [RC, INSURANCE, FITNESS, POLLUTION_PUC, COMMERCIAL_PERMIT, OWNER_AUTHORIZATION, LEASE_AGREEMENT, OTHER]
 *               expiryDate:
 *                 type: string
 *                 format: date
 *                 description: Expiry date in YYYY-MM-DD format
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 */
router.post(
  '/:id/documents',
  upload.single('file'),
  validateRequest(uploadVehicleDocumentSchema),
  vehicleController.uploadDocument
);

/**
 * @openapi
 * /api/v1/partners/vehicles/{id}/documents:
 *   get:
 *     summary: List Vehicle Documents
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of uploaded documents with expiry warnings
 */
router.get('/:id/documents', vehicleController.getVehicleDocuments);

/**
 * @openapi
 * /api/v1/partners/vehicles/{id}/documents/{docId}/file:
 *   get:
 *     summary: Secure Stream of Vehicle Document Binary
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document binary stream
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 */
router.get('/:id/documents/:docId/file', vehicleController.getDocumentFile);

export const vehicleRoutes = router;

