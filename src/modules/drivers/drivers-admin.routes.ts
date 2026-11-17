import { Router } from 'express';
import { driverAdminController } from './drivers-admin.controller';
import {
  requireAuth,
  requireRole,
  validateRequest,
} from '../../common/middlewares';
import { UserRole } from '../../common/constants';
import {
  rejectDriverDocumentSchema,
  approveDriverSchema,
  rejectDriverSchema,
  suspendDriverSchema,
} from './drivers.validator';

const router = Router();

// All admin driver verification endpoints require authentication and ADMIN or SUPER_ADMIN role
router.use(requireAuth, requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));

/**
 * @openapi
 * /api/v1/admin/drivers/pending:
 *   get:
 *     summary: List Pending Driver Applications
 *     description: Retrieves list of submitted driver applications awaiting verification.
 *     tags:
 *       - Admin Drivers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Pending applications retrieved successfully
 */
router.get('/pending', driverAdminController.getPendingDrivers);

/**
 * @openapi
 * /api/v1/admin/drivers/{id}:
 *   get:
 *     summary: Get Full Driver Verification Dossier
 *     description: Retrieves comprehensive dossier including KYC evaluation and documents.
 *     tags:
 *       - Admin Drivers
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
 *         description: Driver dossier retrieved successfully
 *       404:
 *         description: Driver profile not found
 */
router.get('/:id', driverAdminController.getDriverDossier);

/**
 * @openapi
 * /api/v1/admin/drivers/documents/{docId}/verify:
 *   post:
 *     summary: Verify Driver Document
 *     description: Approves document with atomic audit log (self-approval prohibited).
 *     tags:
 *       - Admin Drivers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document verified successfully
 *       403:
 *         description: Cannot verify own document
 */
router.post('/documents/:docId/verify', driverAdminController.verifyDocument);

/**
 * @openapi
 * /api/v1/admin/drivers/documents/{docId}/reject:
 *   post:
 *     summary: Reject Driver Document
 *     description: Rejects document with mandatory reason and atomic audit log.
 *     tags:
 *       - Admin Drivers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: docId
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
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Document rejected successfully
 */
router.post(
  '/documents/:docId/reject',
  validateRequest({ body: rejectDriverDocumentSchema }),
  driverAdminController.rejectDocument
);

/**
 * @openapi
 * /api/v1/admin/drivers/documents/{docId}/file:
 *   get:
 *     summary: Stream Driver Document File for Admin Inspection
 *     description: Streams document binary from private storage.
 *     tags:
 *       - Admin Drivers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document file binary stream
 */
router.get('/documents/:docId/file', driverAdminController.getDocumentFile);

/**
 * @openapi
 * /api/v1/admin/drivers/{id}/approve:
 *   post:
 *     summary: Approve Driver Application
 *     description: Performs fail-closed KYC validation, marks driver approved, provisions availability.
 *     tags:
 *       - Admin Drivers
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
 *               jurisdiction:
 *                 type: string
 *               vehicleTypeCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Driver approved successfully
 *       400:
 *         description: Missing or expired mandatory documents
 *       403:
 *         description: Self-approval prohibited
 */
router.post(
  '/:id/approve',
  validateRequest({ body: approveDriverSchema }),
  driverAdminController.approveDriver
);

/**
 * @openapi
 * /api/v1/admin/drivers/{id}/reject:
 *   post:
 *     summary: Reject Driver Application
 *     description: Rejects driver application with mandatory reason.
 *     tags:
 *       - Admin Drivers
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
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Driver rejected successfully
 */
router.post(
  '/:id/reject',
  validateRequest({ body: rejectDriverSchema }),
  driverAdminController.rejectDriver
);

/**
 * @openapi
 * /api/v1/admin/drivers/{id}/suspend:
 *   post:
 *     summary: Suspend Driver Profile
 *     description: Suspends driver, sets driver offline, and cancels upcoming shifts.
 *     tags:
 *       - Admin Drivers
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
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Driver suspended successfully
 */
router.post(
  '/:id/suspend',
  validateRequest({ body: suspendDriverSchema }),
  driverAdminController.suspendDriver
);

/**
 * @openapi
 * /api/v1/admin/drivers/{id}/reactivate:
 *   post:
 *     summary: Reactivate Suspended Driver Profile
 *     description: Revalidates KYC compliance and restores driver approval status.
 *     tags:
 *       - Admin Drivers
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
 *         description: Driver reactivated successfully
 *       400:
 *         description: Non-suspended driver or KYC revalidation failed
 */
router.post('/:id/reactivate', driverAdminController.reactivateDriver);

export const driverAdminRoutes = router;
