import { Router } from 'express';
import multer from 'multer';
import { workerController } from './workers.controller';
import {
  requireAuth,
  requireWorker,
  validateRequest,
} from '../../common/middlewares';
import {
  requireApprovedWorker,
} from './workers.middleware';
import {
  updateWorkerProfileSchema,
  uploadWorkerDocumentSchema,
  addWorkerSkillSchema,
  acceptWorkerInvitationSchema,
  rejectWorkerInvitationSchema,
  lookupWorkerInvitationSchema,
  terminateAffiliationSchema,
  updateDutyStatusSchema,
  workerHeartbeatSchema,
  workerInvitationFilterQuerySchema,
} from './workers.validator';

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
 * /api/v1/workers/invitations/lookup:
 *   post:
 *     summary: Lookup Worker Invitation by Token (Public)
 *     description: Retrieve basic partner details for an invitation token without authentication.
 *     tags:
 *       - Workers
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: Secure invitation token
 *                 example: d290f1ee-6c54-4b01-90e6-d701748f0851
 *     responses:
 *       200:
 *         description: Invitation details retrieved successfully
 *       400:
 *         description: Validation error or invalid token format
 *       404:
 *         description: Invitation not found or expired
 */
router.post(
  '/invitations/lookup',
  validateRequest({ body: lookupWorkerInvitationSchema }),
  workerController.lookupInvitationByToken
);

/**
 * @openapi
 * /api/v1/workers/invitations/public/{token}:
 *   get:
 *     summary: Inspect Worker Invitation Token Details (Public)
 *     description: Retrieve basic partner details for an invitation token via URL path parameter without authentication.
 *     tags:
 *       - Workers
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
router.get('/invitations/public/:token', workerController.lookupInvitationByToken);

// ============================================================================
// Authenticated Worker Self-Service Endpoints
// Guarded by requireAuth and requireWorker
// ============================================================================

router.use(requireAuth);
router.use(requireWorker);

// ============================================================================
// 1. Worker Profile & Onboarding
// ============================================================================

/**
 * @openapi
 * /api/v1/workers/me:
 *   get:
 *     summary: Get Current Worker Profile
 *     description: Returns the authenticated worker's profile, KYC status, and onboarding progress.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Worker profile retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - WORKER role required
 */
router.get('/me', workerController.getMe);

/**
 * @openapi
 * /api/v1/workers/me:
 *   put:
 *     summary: Update Current Worker Profile
 *     description: Updates personal details, worker type, experience, and bio before onboarding review approval.
 *     tags:
 *       - Workers
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
 *               workerType:
 *                 type: string
 *                 enum: [HELPER, TECHNICIAN, SPECIALIST]
 *               primaryCityId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       400:
 *         description: Validation error
 */
router.put('/me', validateRequest({ body: updateWorkerProfileSchema }), workerController.updateMe);

/**
 * @openapi
 * /api/v1/workers/me/submit:
 *   post:
 *     summary: Submit Worker Application for KYC Verification
 *     description: Submits the worker's onboarding application for administrative review after all required profile details and documents are uploaded.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Application submitted successfully
 *       400:
 *         description: Validation failure or missing mandatory documents
 */
router.post('/me/submit', workerController.submitOnboarding);

/**
 * @openapi
 * /api/v1/workers/me/resubmit:
 *   post:
 *     summary: Resubmit Rejected Worker Application
 *     description: Resubmits the worker onboarding application after addressing admin feedback or replacing rejected documents.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Application resubmitted successfully
 *       400:
 *         description: Application cannot be resubmitted in its current status
 */
router.post('/me/resubmit', workerController.resubmitOnboarding);

/**
 * @openapi
 * /api/v1/workers/me/status:
 *   get:
 *     summary: Get Worker Onboarding & Approval Status
 *     description: Returns detailed flags indicating onboarding submission status, approval status, and document readiness.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status retrieved successfully
 */
router.get('/me/status', workerController.getStatus);

// ============================================================================
// 2. KYC Document Management
// ============================================================================

/**
 * @openapi
 * /api/v1/workers/me/documents:
 *   post:
 *     summary: Upload Worker KYC Document
 *     description: Uploads a mandatory or optional KYC document (identity proof, police verification, etc.) with multipart file upload.
 *     tags:
 *       - Workers
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
 *                 enum: [IDENTITY_PROOF, PROFILE_PHOTO, POLICE_VERIFICATION, ADDRESS_PROOF, SKILL_CERTIFICATE, MEDICAL_FITNESS, OTHER]
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
 *       400:
 *         description: Validation failure or invalid file format
 */
router.post(
  '/me/documents',
  upload.single('file'),
  validateRequest({ body: uploadWorkerDocumentSchema }),
  workerController.uploadDocument
);

/**
 * @openapi
 * /api/v1/workers/me/documents/{id}:
 *   put:
 *     summary: Replace Worker Document File
 *     description: Uploads a replacement file for an existing KYC document (e.g. after document rejection).
 *     tags:
 *       - Workers
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
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Document file replaced successfully
 *       404:
 *         description: Document not found
 */
router.put('/me/documents/:id', upload.single('file'), workerController.replaceDocument);

/**
 * @openapi
 * /api/v1/workers/me/documents:
 *   get:
 *     summary: List Uploaded Worker Documents
 *     description: Retrieves all KYC documents uploaded by the authenticated worker with their verification status.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Documents retrieved successfully
 */
router.get('/me/documents', workerController.getDocuments);

/**
 * @openapi
 * /api/v1/workers/me/documents/{id}:
 *   get:
 *     summary: Get Worker Document Details
 *     description: Retrieves metadata and verification status for a specific document owned by the authenticated worker.
 *     tags:
 *       - Workers
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
 *         description: Document details retrieved successfully
 *       404:
 *         description: Document not found or unauthorized (IDOR prevented)
 */
router.get('/me/documents/:id', workerController.getDocumentDetails);

/**
 * @openapi
 * /api/v1/workers/me/documents/{id}/file:
 *   get:
 *     summary: Securely Download Worker Document File
 *     description: Streams private document binary for authenticated worker with strict IDOR prevention.
 *     tags:
 *       - Workers
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
 *         description: Binary file stream
 *       403:
 *         description: Forbidden (IDOR prevention)
 *       404:
 *         description: Document not found
 */
router.get('/me/documents/:id/file', workerController.getDocumentFile);

// ============================================================================
// 3. Worker Skills Management
// ============================================================================

/**
 * @openapi
 * /api/v1/workers/me/skills:
 *   post:
 *     summary: Register Trade Skill
 *     description: Adds a trade/service category skill to the worker's profile.
 *     tags:
 *       - Workers
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
 *                 description: ID of the service category
 *               experienceYears:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Worker skill registered successfully
 *       400:
 *         description: Duplicate skill or invalid category
 */
router.post('/me/skills', validateRequest({ body: addWorkerSkillSchema }), workerController.addSkill);

/**
 * @openapi
 * /api/v1/workers/me/skills:
 *   get:
 *     summary: List Worker Trade Skills
 *     description: Lists all trade skills registered by the authenticated worker with verification status.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Worker skills retrieved successfully
 */
router.get('/me/skills', workerController.getSkills);

/**
 * @openapi
 * /api/v1/workers/me/skills/{id}:
 *   delete:
 *     summary: Remove Trade Skill
 *     description: Deletes a trade skill from the worker's profile.
 *     tags:
 *       - Workers
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
 *         description: Worker skill removed successfully
 *       404:
 *         description: Skill not found or unauthorized
 */
router.delete('/me/skills/:id', workerController.removeSkill);

// ============================================================================
// 4. Worker Invitations Management
// ============================================================================

/**
 * @openapi
 * /api/v1/workers/me/invitations:
 *   get:
 *     summary: List Received Partner Invitations
 *     description: Lists partner invitations targeted at the worker's registered mobile number.
 *     tags:
 *       - Workers
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
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Worker invitations retrieved successfully
 */
router.get(
  '/me/invitations',
  validateRequest({ query: workerInvitationFilterQuerySchema }),
  workerController.getReceivedInvitations
);

/**
 * @openapi
 * /api/v1/workers/me/invitations/{id}:
 *   get:
 *     summary: Get Worker Invitation Details
 *     description: Retrieves details of a specific invitation sent to the worker.
 *     tags:
 *       - Workers
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
 *         description: Invitation details retrieved successfully
 *       404:
 *         description: Invitation not found or unauthorized
 */
router.get('/me/invitations/:id', workerController.getInvitationById);

/**
 * @openapi
 * /api/v1/workers/me/invitations/{id}/accept:
 *   post:
 *     summary: Accept Partner Invitation
 *     description: Explicitly accepts a partner invitation, establishing an active affiliation.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invitation accepted successfully
 *       400:
 *         description: Invitation not in PENDING status or worker not eligible
 */
router.post(
  '/me/invitations/:id/accept',
  validateRequest({ body: acceptWorkerInvitationSchema }),
  workerController.acceptInvitation
);

/**
 * @openapi
 * /api/v1/workers/me/invitations/{id}/reject:
 *   post:
 *     summary: Reject Partner Invitation
 *     description: Explicitly declines a partner invitation with an optional reason.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invitation declined successfully
 *       400:
 *         description: Invitation not in PENDING status
 */
router.post(
  '/me/invitations/:id/reject',
  validateRequest({ body: rejectWorkerInvitationSchema }),
  workerController.rejectInvitation
);

// ============================================================================
// 5. Worker-Partner Affiliations
// ============================================================================

/**
 * @openapi
 * /api/v1/workers/me/affiliations:
 *   get:
 *     summary: List Worker Partner Affiliations
 *     description: Lists active or historical partner affiliations for the authenticated worker.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, TERMINATED, SUSPENDED]
 *     responses:
 *       200:
 *         description: Worker affiliations retrieved successfully
 */
router.get('/me/affiliations', workerController.getAffiliations);
router.get('/me/affiliations/history', workerController.getAffiliationHistory);

/**
 * @openapi
 * /api/v1/workers/me/affiliations/{id}:
 *   get:
 *     summary: Get Worker Affiliation Details
 *     description: Retrieves details of a specific affiliation belonging to the worker.
 *     tags:
 *       - Workers
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
 *         description: Affiliation details retrieved successfully
 *       404:
 *         description: Affiliation not found
 */
router.get('/me/affiliations/:id', workerController.getAffiliationById);

/**
 * @openapi
 * /api/v1/workers/me/affiliations/{id}/terminate:
 *   post:
 *     summary: Voluntarily Terminate Worker Affiliation
 *     description: Ends an active partner affiliation initiated by the worker.
 *     tags:
 *       - Workers
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
 *                 example: Switching service focus
 *     responses:
 *       200:
 *         description: Affiliation terminated successfully
 *       400:
 *         description: Affiliation is not active or reason missing
 */
router.post(
  '/me/affiliations/:id/terminate',
  validateRequest({ body: terminateAffiliationSchema }),
  workerController.terminateAffiliation
);

/**
 * @openapi
 * /api/v1/workers/me/affiliations/{id}/history:
 *   get:
 *     summary: Get Worker Affiliation History
 *     description: Retrieves historical status transitions and audit records for an affiliation.
 *     tags:
 *       - Workers
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
 *         description: Affiliation history retrieved successfully
 *       404:
 *         description: Affiliation not found
 */
router.get('/me/affiliations/:id/history', workerController.getAffiliationHistory);

// ============================================================================
// 6. Availability & Heartbeat
// ============================================================================

/**
 * @openapi
 * /api/v1/workers/me/availability:
 *   get:
 *     summary: Get Current Worker Availability Status
 *     description: Retrieves the current duty status (ONLINE, OFFLINE, ON_TASK), last heartbeat, and GPS coordinates.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Worker availability retrieved successfully
 */
router.get('/me/availability', workerController.getAvailability);

/**
 * @openapi
 * /api/v1/workers/me/duty-status:
 *   post:
 *     summary: Update Online Duty Status (POST)
 *     description: Toggles worker online/offline availability for dispatching. Requires APPROVED worker profile.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isOnline
 *             properties:
 *               isOnline:
 *                 type: boolean
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Duty status updated successfully
 *       403:
 *         description: Worker account not approved or suspended
 */
router.post(
  '/me/duty-status',
  requireApprovedWorker,
  validateRequest({ body: updateDutyStatusSchema }),
  workerController.updateDutyStatus
);

/**
 * @openapi
 * /api/v1/workers/me/duty-status:
 *   patch:
 *     summary: Update Online Duty Status (PATCH)
 *     description: Toggles worker online/offline availability for dispatching. Requires APPROVED worker profile.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isOnline
 *             properties:
 *               isOnline:
 *                 type: boolean
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Duty status updated successfully
 *       403:
 *         description: Worker account not approved or suspended
 */
router.patch(
  '/me/duty-status',
  requireApprovedWorker,
  validateRequest({ body: updateDutyStatusSchema }),
  workerController.updateDutyStatus
);

/**
 * @openapi
 * /api/v1/workers/me/heartbeat:
 *   post:
 *     summary: Worker Operational Heartbeat
 *     description: Records operational keep-alive and updates GPS coordinates. Requires APPROVED worker profile.
 *     tags:
 *       - Workers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Heartbeat recorded successfully
 *       403:
 *         description: Worker account not approved or suspended
 */
router.post(
  '/me/heartbeat',
  requireApprovedWorker,
  validateRequest({ body: workerHeartbeatSchema }),
  workerController.updateHeartbeat
);

export const workerRoutes = router;
