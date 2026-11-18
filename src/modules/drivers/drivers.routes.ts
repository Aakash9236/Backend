import { Router } from 'express';
import multer from 'multer';
import { driverController } from './drivers.controller';
import {
  requireAuth,
  validateRequest,
} from '../../common/middlewares';
import {
  requireOperationalDriver,
  requireApprovedDriver,
} from './drivers.middleware';
import {
  updateDriverProfileSchema,
  uploadDriverDocumentSchema,
  rejectDriverInvitationSchema,
  terminateAffiliationSchema,
  startShiftSchema,
  completeShiftSchema,
  cancelAssignmentSchema,
  updateDutyStatusSchema,
  driverHeartbeatSchema,
} from './drivers.validator';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

const router = Router();

// ============================================================================
// Public Endpoints
// ============================================================================

/**
 * @openapi
 * /api/v1/drivers/invitations/public/{token}:
 *   get:
 *     summary: Inspect Driver Invitation Token Details
 *     description: Retrieve basic partner details for an invitation without authentication.
 *     tags:
 *       - Drivers
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invitation details retrieved successfully
 *       404:
 *         description: Invitation not found or expired
 */
router.get('/invitations/public/:token', driverController.getInvitationByToken);

// ============================================================================
// Authenticated Driver Endpoints
// ============================================================================

router.use(requireAuth);

/**
 * @openapi
 * /api/v1/drivers/me:
 *   get:
 *     summary: Get Current Driver Profile
 *     description: Returns the authenticated user's driver profile and KYC status.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Driver profile retrieved successfully
 *       404:
 *         description: Driver profile not found
 */
router.get('/me', driverController.getMe);

/**
 * @openapi
 * /api/v1/drivers/me:
 *   put:
 *     summary: Update Driver Profile Details
 *     description: Updates personal and licence information before review approval.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *                 enum: [MALE, FEMALE, OTHER]
 *               bio:
 *                 type: string
 *               experienceYears:
 *                 type: integer
 *               licenceNumber:
 *                 type: string
 *               licenceClasses:
 *                 type: array
 *                 items:
 *                   type: string
 *               licenceExpiryDate:
 *                 type: string
 *                 format: date
 *               issuingAuthority:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.put('/me', validateRequest({ body: updateDriverProfileSchema }), driverController.updateMe);

/**
 * @openapi
 * /api/v1/drivers/me/submit:
 *   post:
 *     summary: Submit Driver Profile for KYC Verification
 *     description: Submits the completed driver application for administrative review.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Application submitted successfully
 */
router.post('/me/submit', driverController.submitOnboarding);

/**
 * @openapi
 * /api/v1/drivers/me/resubmit:
 *   post:
 *     summary: Resubmit Rejected Driver Profile
 *     description: Resubmits profile after correcting rejected documents or details.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Application resubmitted successfully
 */
router.post('/me/resubmit', driverController.resubmitOnboarding);

/**
 * @openapi
 * /api/v1/drivers/me/status:
 *   get:
 *     summary: Get Driver Onboarding & Approval Status
 *     description: Returns submission and approval status flags.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status retrieved successfully
 */
router.get('/me/status', driverController.getStatus);

/**
 * @openapi
 * /api/v1/drivers/me/documents:
 *   post:
 *     summary: Upload Driver Document
 *     description: Uploads a driver KYC document (licence, aadhaar, photo, etc.).
 *     tags:
 *       - Drivers
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
 *               - file
 *             properties:
 *               documentType:
 *                 type: string
 *                 enum: [DRIVING_LICENCE, PROFILE_PHOTO, IDENTITY_PROOF, POLICE_VERIFICATION, MEDICAL_FITNESS, ADDRESS_PROOF]
 *               documentNumber:
 *                 type: string
 *               expiryDate:
 *                 type: string
 *                 format: date
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 */
router.post(
  '/me/documents',
  upload.single('file'),
  validateRequest({ body: uploadDriverDocumentSchema }),
  driverController.uploadDocument
);

/**
 * @openapi
 * /api/v1/drivers/me/documents:
 *   get:
 *     summary: List Uploaded Driver Documents
 *     description: Lists all documents uploaded by the authenticated driver.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Documents retrieved successfully
 */
router.get('/me/documents', driverController.getDocuments);

/**
 * @openapi
 * /api/v1/drivers/me/documents/{id}/file:
 *   get:
 *     summary: Securely Download Driver Document File
 *     description: Streams private document binary for authenticated driver.
 *     tags:
 *       - Drivers
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
 *         description: File binary stream
 *       403:
 *         description: Forbidden (IDOR prevention)
 */
router.get('/me/documents/:id/file', driverController.getDocumentFile);

// ============================================================================
// Driver Invitations
// ============================================================================

/**
 * @openapi
 * /api/v1/drivers/invitations:
 *   get:
 *     summary: List Received Fleet Invitations
 *     description: Lists fleet partnership invitations sent to the driver's phone number.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invitations retrieved successfully
 */
router.get('/invitations', driverController.getReceivedInvitations);

/**
 * @openapi
 * /api/v1/drivers/invitations/{id}/accept:
 *   post:
 *     summary: Accept Fleet Invitation
 *     description: Establishes a multi-tenant affiliation between driver and fleet partner.
 *     tags:
 *       - Drivers
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
 *         description: Invitation accepted successfully
 */
router.post('/invitations/:id/accept', driverController.acceptInvitation);

/**
 * @openapi
 * /api/v1/drivers/invitations/{id}/reject:
 *   post:
 *     summary: Reject Fleet Invitation
 *     description: Declines partnership invitation with optional reason.
 *     tags:
 *       - Drivers
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
 *         description: Invitation rejected
 */
router.post(
  '/invitations/:id/reject',
  validateRequest({ body: rejectDriverInvitationSchema }),
  driverController.rejectInvitation
);

// ============================================================================
// Driver Affiliations
// ============================================================================

/**
 * @openapi
 * /api/v1/drivers/affiliations:
 *   get:
 *     summary: List Driver Fleet Affiliations
 *     description: Lists active or historical fleet partner affiliations.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Affiliations retrieved successfully
 */
router.get('/affiliations', driverController.getAffiliations);

/**
 * @openapi
 * /api/v1/drivers/affiliations/{id}:
 *   get:
 *     summary: Get Driver Affiliation Details
 *     description: Retrieves details of a specific fleet affiliation.
 *     tags:
 *       - Drivers
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
 *         description: Affiliation details retrieved
 */
router.get('/affiliations/:id', driverController.getAffiliationById);

/**
 * @openapi
 * /api/v1/drivers/affiliations/{id}/terminate:
 *   post:
 *     summary: Terminate Fleet Affiliation by Driver
 *     description: Voluntarily disaffiliates from fleet partner (blocked during active shift).
 *     tags:
 *       - Drivers
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
 *         description: Affiliation terminated
 */
router.post(
  '/affiliations/:id/terminate',
  validateRequest({ body: terminateAffiliationSchema }),
  driverController.terminateAffiliation
);

// ============================================================================
// Driver Shifts & Operational Lifecycle
// ============================================================================

/**
 * @openapi
 * /api/v1/drivers/assignments:
 *   get:
 *     summary: List Driver Vehicle Assignments & Shifts
 *     description: Lists assigned shifts with fleet partners.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Assignments retrieved successfully
 */
router.get('/assignments', driverController.getAssignments);

/**
 * @openapi
 * /api/v1/drivers/assignments/{id}:
 *   get:
 *     summary: Get Assignment Details
 *     description: Retrieves specific vehicle shift assignment details.
 *     tags:
 *       - Drivers
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
router.get('/assignments/:id', driverController.getAssignmentById);

/**
 * @openapi
 * /api/v1/drivers/assignments/{id}/start-shift:
 *   post:
 *     summary: Explicitly Start Shift with Vehicle Possession Confirmation
 *     description: Activates scheduled shift, confirms possession, and sets driver online.
 *     tags:
 *       - Drivers
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
 *         description: Shift started successfully
 */
router.post(
  '/assignments/:id/start-shift',
  requireOperationalDriver,
  validateRequest({ body: startShiftSchema }),
  driverController.startShift
);

/**
 * @openapi
 * /api/v1/drivers/assignments/{id}/complete-shift:
 *   post:
 *     summary: Complete Active Shift
 *     description: Concludes active shift, records end timestamp, and sets driver offline.
 *     tags:
 *       - Drivers
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
 *         description: Shift completed successfully
 */
router.post(
  '/assignments/:id/complete-shift',
  requireApprovedDriver,
  validateRequest({ body: completeShiftSchema }),
  driverController.completeShift
);

/**
 * @openapi
 * /api/v1/drivers/assignments/{id}/cancel-shift:
 *   post:
 *     summary: Cancel Shift by Driver
 *     description: Cancels scheduled shift; requires owner approval if cancelled within 2h.
 *     tags:
 *       - Drivers
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
 *         description: Shift cancelled
 */
router.post(
  '/assignments/:id/cancel-shift',
  requireApprovedDriver,
  validateRequest({ body: cancelAssignmentSchema }),
  driverController.cancelShift
);

/**
 * @openapi
 * /api/v1/drivers/duty-status:
 *   patch:
 *     summary: Update Online Duty Status
 *     description: Toggles driver online/offline availability for dispatching.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Duty status updated
 */
router.patch(
  '/duty-status',
  requireOperationalDriver,
  validateRequest({ body: updateDutyStatusSchema }),
  driverController.updateDutyStatus
);

/**
 * @openapi
 * /api/v1/drivers/heartbeat:
 *   post:
 *     summary: Driver Operational Heartbeat
 *     description: Records operational keep-alive and updates GPS coordinates.
 *     tags:
 *       - Drivers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Heartbeat recorded
 */
router.post(
  '/heartbeat',
  requireOperationalDriver,
  validateRequest({ body: driverHeartbeatSchema }),
  driverController.sendHeartbeat
);

export const driverRoutes = router;
