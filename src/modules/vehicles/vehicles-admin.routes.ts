import { Router } from 'express';
import { adminVehicleController } from './vehicles-admin.controller';
import {
  requireAuth,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  validateRequest,
} from '../../common/middlewares';
import {
  rejectVehicleSchema,
  suspendVehicleSchema,
  rejectVehicleDocumentSchema,
  transferVehicleSchema,
} from './vehicles.validator';

const router = Router();

// All admin vehicle endpoints require authentication and ADMIN or SUPER_ADMIN role
router.use(requireAuth);

/**
 * @openapi
 * /api/v1/admin/vehicles/pending:
 *   get:
 *     summary: List Pending Vehicles Verification Queue
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Queue of vehicles pending verification
 */
router.get('/pending', requireAdmin, adminVehicleController.getPendingVehicles);

/**
 * @openapi
 * /api/v1/admin/vehicles/documents/{docId}/verify:
 *   post:
 *     summary: Verify Vehicle Document
 *     tags:
 *       - Admin
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
 */
router.post('/documents/:docId/verify', requireAdmin, adminVehicleController.verifyVehicleDocument);

/**
 * @openapi
 * /api/v1/admin/vehicles/documents/{docId}/reject:
 *   post:
 *     summary: Reject Vehicle Document
 *     tags:
 *       - Admin
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
  requireAdmin,
  validateRequest(rejectVehicleDocumentSchema),
  adminVehicleController.rejectVehicleDocument
);

/**
 * @openapi
 * /api/v1/admin/vehicles/documents/{docId}/file:
 *   get:
 *     summary: Secure Stream of Vehicle Document Binary for Admin
 *     tags:
 *       - Admin
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
 *         description: Binary file stream
 */
router.get('/documents/:docId/file', requireAdmin, adminVehicleController.getDocumentFileForAdmin);

/**
 * @openapi
 * /api/v1/admin/vehicles/{id}:
 *   get:
 *     summary: Get Full Vehicle Inspection Dossier
 *     tags:
 *       - Admin
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
 *         description: Vehicle inspection dossier
 */
router.get('/:id', requireAdmin, adminVehicleController.getVehicleDossier);

/**
 * @openapi
 * /api/v1/admin/vehicles/{id}/approve:
 *   patch:
 *     summary: Approve Vehicle
 *     description: Approves vehicle. Fails closed if mandatory documents are missing, unverified, or expired.
 *     tags:
 *       - Admin
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
 *         description: Vehicle approved successfully
 *       400:
 *         description: Approval gate failed (missing or expired documents)
 */
router.patch('/:id/approve', requireAdmin, adminVehicleController.approveVehicle);
router.post('/:id/approve', requireAdmin, adminVehicleController.approveVehicle);

/**
 * @openapi
 * /api/v1/admin/vehicles/{id}/reject:
 *   patch:
 *     summary: Reject Vehicle Application
 *     tags:
 *       - Admin
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
 *         description: Vehicle rejected
 */
router.patch(
  '/:id/reject',
  requireAdmin,
  validateRequest(rejectVehicleSchema),
  adminVehicleController.rejectVehicle
);
router.post(
  '/:id/reject',
  requireAdmin,
  validateRequest(rejectVehicleSchema),
  adminVehicleController.rejectVehicle
);

/**
 * @openapi
 * /api/v1/admin/vehicles/{id}/suspend:
 *   patch:
 *     summary: Suspend Verified Vehicle
 *     tags:
 *       - Admin
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
 *         description: Vehicle suspended
 */
router.patch(
  '/:id/suspend',
  requireAdmin,
  validateRequest(suspendVehicleSchema),
  adminVehicleController.suspendVehicle
);
router.post(
  '/:id/suspend',
  requireAdmin,
  validateRequest(suspendVehicleSchema),
  adminVehicleController.suspendVehicle
);

/**
 * @openapi
 * /api/v1/admin/vehicles/{id}/reactivate:
 *   patch:
 *     summary: Reactivate Suspended Vehicle
 *     tags:
 *       - Admin
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
 *         description: Vehicle reactivated
 */
router.patch('/:id/reactivate', requireAdmin, adminVehicleController.reactivateVehicle);
router.post('/:id/reactivate', requireAdmin, adminVehicleController.reactivateVehicle);

/**
 * @openapi
 * /api/v1/admin/vehicles/{id}/transfer:
 *   post:
 *     summary: Authorize Vehicle Ownership Transfer (Super Admin Only)
 *     description: Transfers vehicle ownership from old partner to new partner, updating history and resetting status to PENDING.
 *     tags:
 *       - Admin
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
 *               - targetPartnerId
 *               - transferReason
 *             properties:
 *               targetPartnerId:
 *                 type: string
 *               transferReason:
 *                 type: string
 *               newOwnershipType:
 *                 type: string
 *                 enum: [OWNER, LEASED, AUTHORIZED_REPRESENTATIVE]
 *               newOwnerName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vehicle transferred successfully
 *       403:
 *         description: Super Admin only
 */
router.post(
  '/:id/transfer',
  requireSuperAdmin,
  validateRequest(transferVehicleSchema),
  adminVehicleController.transferVehicleOwnership
);

export const adminVehicleRoutes = router;

