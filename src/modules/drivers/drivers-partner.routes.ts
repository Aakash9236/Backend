import { Router } from 'express';
import { driverPartnerController } from './drivers-partner.controller';
import {
  requireAuth,
  requireActiveRole,
  validateRequest,
} from '../../common/middlewares';
import { UserRole } from '../../common/constants';
import {
  createDriverInvitationSchema,
  revokeDriverInvitationSchema,
  terminateAffiliationSchema,
  scheduleAssignmentSchema,
  cancelAssignmentSchema,
  approveCancellationSchema,
} from './drivers.validator';

const router = Router();

// All partner driver management routes require authentication and active PARTNER role
router.use(requireAuth, requireActiveRole(UserRole.PARTNER));

// ============================================================================
// Driver Invitations
// ============================================================================

/**
 * @openapi
 * /api/v1/partners/drivers/invitations:
 *   post:
 *     summary: Invite Driver to Fleet
 *     description: Sends partnership invitation to driver mobile number with 7-day validity.
 *     tags:
 *       - Fleet Drivers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - invitedMobile
 *             properties:
 *               invitedMobile:
 *                 type: string
 *                 example: "+919876543210"
 *               driverName:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Invitation sent successfully
 *       400:
 *         description: Invalid mobile number
 *       409:
 *         description: Driver already actively affiliated
 */
router.post(
  '/invitations',
  validateRequest({ body: createDriverInvitationSchema }),
  driverPartnerController.sendInvitation
);

/**
 * @openapi
 * /api/v1/partners/drivers/invitations:
 *   get:
 *     summary: List Fleet Invitations
 *     description: Lists all invitations sent by the authenticated partner.
 *     tags:
 *       - Fleet Drivers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, ACCEPTED, REJECTED, EXPIRED, REVOKED]
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
 *         description: Invitations retrieved successfully
 */
router.get('/invitations', driverPartnerController.listInvitations);

/**
 * @openapi
 * /api/v1/partners/drivers/invitations/{id}:
 *   get:
 *     summary: Get Invitation Details
 *     description: Retrieves details of a specific fleet invitation.
 *     tags:
 *       - Fleet Drivers
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
 *         description: Invitation details retrieved
 *       403:
 *         description: Forbidden (cross-partner isolation)
 */
router.get('/invitations/:id', driverPartnerController.getInvitation);

/**
 * @openapi
 * /api/v1/partners/drivers/invitations/{id}/revoke:
 *   post:
 *     summary: Revoke Pending Invitation
 *     description: Revokes pending invitation before acceptance.
 *     tags:
 *       - Fleet Drivers
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
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invitation revoked successfully
 */
router.post(
  '/invitations/:id/revoke',
  validateRequest({ body: revokeDriverInvitationSchema }),
  driverPartnerController.revokeInvitation
);

// ============================================================================
// Fleet Driver Affiliations
// ============================================================================

/**
 * @openapi
 * /api/v1/partners/drivers/affiliations:
 *   get:
 *     summary: List Affiliated Drivers
 *     description: Lists drivers actively affiliated with the partner's fleet.
 *     tags:
 *       - Fleet Drivers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, TERMINATED]
 *     responses:
 *       200:
 *         description: Affiliated drivers retrieved
 */
router.get('/affiliations', driverPartnerController.listAffiliatedDrivers);

/**
 * @openapi
 * /api/v1/partners/drivers/affiliations/{id}/terminate:
 *   post:
 *     summary: Terminate Driver Affiliation by Partner
 *     description: Disaffiliates driver from fleet; cancels future scheduled shifts.
 *     tags:
 *       - Fleet Drivers
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
 *         description: Affiliation terminated successfully
 *       409:
 *         description: Cannot terminate during active shift
 */
router.post(
  '/affiliations/:id/terminate',
  validateRequest({ body: terminateAffiliationSchema }),
  driverPartnerController.terminateAffiliation
);

// ============================================================================
// Fleet Vehicle Shift Assignments
// ============================================================================

/**
 * @openapi
 * /api/v1/partners/drivers/assignments:
 *   post:
 *     summary: Schedule Driver Shift Assignment
 *     description: Schedules a vehicle shift for an affiliated driver with licence-vehicle compatibility checks.
 *     tags:
 *       - Fleet Drivers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - driverId
 *               - vehicleId
 *               - startTime
 *             properties:
 *               driverId:
 *                 type: string
 *               vehicleId:
 *                 type: string
 *               startTime:
 *                 type: string
 *                 format: date-time
 *               endTime:
 *                 type: string
 *                 format: date-time
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Shift scheduled successfully
 *       400:
 *         description: Incompatible licence or unverified documents
 *       409:
 *         description: Overlapping shift detected
 */
router.post(
  '/assignments',
  validateRequest({ body: scheduleAssignmentSchema }),
  driverPartnerController.scheduleAssignment
);

/**
 * @openapi
 * /api/v1/partners/drivers/assignments:
 *   get:
 *     summary: List Partner Vehicle Shift Assignments
 *     description: Lists shift assignments for vehicles/drivers in the partner's fleet.
 *     tags:
 *       - Fleet Drivers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [SCHEDULED, ACTIVE, COMPLETED, CANCELLED]
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
 *         description: Assignments retrieved successfully
 */
router.get('/assignments', driverPartnerController.listAssignments);

/**
 * @openapi
 * /api/v1/partners/drivers/assignments/{id}:
 *   get:
 *     summary: Get Shift Assignment Details
 *     description: Retrieves details of a specific vehicle shift assignment.
 *     tags:
 *       - Fleet Drivers
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
 *         description: Assignment details retrieved
 */
router.get('/assignments/:id', driverPartnerController.getAssignment);

/**
 * @openapi
 * /api/v1/partners/drivers/assignments/{id}/cancel:
 *   post:
 *     summary: Cancel Shift Assignment by Partner
 *     description: Cancels scheduled shift with mandatory reason.
 *     tags:
 *       - Fleet Drivers
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
 *         description: Shift cancelled successfully
 */
router.post(
  '/assignments/:id/cancel',
  validateRequest({ body: cancelAssignmentSchema }),
  driverPartnerController.cancelAssignment
);

/**
 * @openapi
 * /api/v1/partners/drivers/assignments/{id}/approve-cancellation:
 *   post:
 *     summary: Approve Driver Short-Notice Shift Cancellation
 *     description: Partner explicitly approves shift cancellation initiated by driver within 2 hours.
 *     tags:
 *       - Fleet Drivers
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
 *               - driverCancellationReason
 *             properties:
 *               driverCancellationReason:
 *                 type: string
 *               ownerApprovalNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cancellation approved successfully
 */
router.post(
  '/assignments/:id/approve-cancellation',
  validateRequest({ body: approveCancellationSchema }),
  driverPartnerController.approveCancellation
);

export const driverPartnerRoutes = router;
