import { Router } from 'express';
import { adminController } from './admin.controller';
import { requireAuth, requireAdmin, requireSuperAdmin, validateRequest } from '../../common/middlewares';
import { rejectionReasonSchema, suspensionReasonSchema, assignRoleSchema } from './admin.validator';

const router = Router();

// Enforce both authentication and Admin privilege for all routes in this module
router.use(requireAuth, requireAdmin);

/**
 * @openapi
 * /api/v1/admin/partners/pending:
 *   get:
 *     summary: List All Pending Partner Applications
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending partner applications.
 *       403:
 *         description: Forbidden (Admin role required).
 */
router.get('/partners/pending', adminController.getPendingPartners);

/**
 * @openapi
 * /api/v1/admin/partners/{id}:
 *   get:
 *     summary: Retrieve Full Partner Details for Review
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
 *         description: Partner review dossier.
 */
router.get('/partners/:id', adminController.getPartnerById);

/**
 * @openapi
 * /api/v1/admin/partners/{id}/approve:
 *   patch:
 *     summary: Approve Partner Application
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
 *         description: Partner approved.
 */
router.patch('/partners/:id/approve', adminController.approvePartner);

/**
 * @openapi
 * /api/v1/admin/partners/{id}/reject:
 *   patch:
 *     summary: Reject Partner Application with Reason
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
 *         description: Partner rejected.
 */
router.patch(
  '/partners/:id/reject',
  validateRequest(rejectionReasonSchema),
  adminController.rejectPartner
);

/**
 * @openapi
 * /api/v1/admin/partners/{id}/suspend:
 *   patch:
 *     summary: Suspend Active Partner Account
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
 *         description: Partner suspended.
 */
router.patch(
  '/partners/:id/suspend',
  validateRequest(suspensionReasonSchema),
  adminController.suspendPartner
);

/**
 * @openapi
 * /api/v1/admin/partners/documents/{id}/file:
 *   get:
 *     summary: Stream KYC Verification Document File Securely
 *     description: Allows administrators to view/download KYC document binary files without exposing internal storage paths.
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
 *         description: Partner document database ID
 *     responses:
 *       200:
 *         description: Document binary content streamed with safe Content-Type and inline Content-Disposition.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid document ID format.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden (Admin role required).
 *       404:
 *         description: Document not found or physical file missing.
 */
router.get('/partners/documents/:id/file', adminController.getDocumentFile);

/**
 * @openapi
 * /api/v1/admin/partners/documents/{id}/verify:
 *   patch:
 *     summary: Verify Individual Partner KYC Document
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
 *         description: Document verified.
 */
router.patch('/partners/documents/:id/verify', adminController.verifyDocument);

/**
 * @openapi
 * /api/v1/admin/partners/documents/{id}/reject:
 *   patch:
 *     summary: Reject Partner KYC Document
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
 *         description: Document rejected.
 */
router.patch(
  '/partners/documents/:id/reject',
  validateRequest(rejectionReasonSchema),
  adminController.rejectDocument
);

/**
 * @openapi
 * /api/v1/admin/partners/skills/{id}/verify:
 *   patch:
 *     summary: Verify Partner Service Skill
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
 *         description: Skill verified.
 */
router.patch('/partners/skills/:id/verify', adminController.verifySkill);

/**
 * @openapi
 * /api/v1/admin/partners/skills/{id}/reject:
 *   patch:
 *     summary: Reject Partner Service Skill
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
 *         description: Skill rejected.
 */
router.patch('/partners/skills/:id/reject', adminController.rejectSkill);

/**
 * @openapi
 * /api/v1/admin/users/{id}/roles:
 *   post:
 *     summary: Assign Privileged Role to User (Super Admin Only)
 *     description: Atomically assigns a new role to a user account and writes an audit log. Idempotent if role already assigned.
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
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [CUSTOMER, PARTNER, DRIVER, WORKER, ADMIN, SUPER_ADMIN]
 *     responses:
 *       200:
 *         description: Role assigned successfully.
 *       400:
 *         description: Invalid role name or user ID.
 *       403:
 *         description: Forbidden (Super Admin role required or self-escalation attempt).
 *       404:
 *         description: User or role not found.
 */
router.post(
  '/users/:id/roles',
  requireSuperAdmin,
  validateRequest(assignRoleSchema),
  adminController.assignUserRole
);

/**
 * @openapi
 * /api/v1/admin/users/{id}/roles/{roleName}:
 *   delete:
 *     summary: Revoke Role from User (Super Admin Only)
 *     description: Atomically revokes a role from a user account and writes an audit log. Protected against removing the last role and last SUPER_ADMIN.
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
 *       - in: path
 *         name: roleName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role revoked successfully.
 *       400:
 *         description: Cannot revoke last role or last SUPER_ADMIN.
 *       403:
 *         description: Forbidden (Super Admin role required or self-revocation attempt).
 *       404:
 *         description: User or role not found.
 */
router.delete(
  '/users/:id/roles/:roleName',
  requireSuperAdmin,
  adminController.revokeUserRole
);

export const adminRoutes = router;
