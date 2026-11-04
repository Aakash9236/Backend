import { Router } from 'express';
import { authController } from './auth.controller';
import { validateRequest, requireAuth, requireCustomer, requireAdmin } from '../../common/middlewares';
import { ApiResponse } from '../../common/utils/api-response.util';
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  switchRoleSchema,
} from './auth.validator';

const router = Router();

/**
 * @openapi
 * /api/v1/auth/otp/request:
 *   post:
 *     summary: Request OTP for Mobile Authentication
 *     description: Validates Indian mobile number and sends cryptographic OTP (or returns mock in development).
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mobileNumber
 *             properties:
 *               mobileNumber:
 *                 type: string
 *                 example: "9876543210"
 *               purpose:
 *                 type: string
 *                 enum: [AUTHENTICATION, CHANGE_MOBILE, PASSWORD_RESET]
 *                 default: AUTHENTICATION
 *     responses:
 *       200:
 *         description: OTP generated and sent successfully.
 *       400:
 *         description: Cooldown active or rate limit exceeded.
 *       422:
 *         description: Validation error.
 */
router.post('/otp/request', validateRequest(requestOtpSchema), authController.requestOtp);

/**
 * @openapi
 * /api/v1/auth/otp/verify:
 *   post:
 *     summary: Verify OTP and Register or Login User
 *     description: Verifies OTP against salted hash. Returns JWT Access Token, Refresh Token, and User Profile.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mobileNumber
 *               - otp
 *             properties:
 *               mobileNumber:
 *                 type: string
 *                 example: "9876543210"
 *               otp:
 *                 type: string
 *                 example: "123456"
 *               deviceId:
 *                 type: string
 *                 example: "device-uuid-123"
 *               deviceName:
 *                 type: string
 *                 example: "Pixel 8 Pro"
 *     responses:
 *       200:
 *         description: Authentication successful.
 *       400:
 *         description: Invalid or expired OTP / Maximum attempts reached.
 *       403:
 *         description: User account is blocked or inactive.
 *       422:
 *         description: Validation error.
 */
router.post('/otp/verify', validateRequest(verifyOtpSchema), authController.verifyOtp);

/**
 * @openapi
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Refresh Tokens with Token Rotation and Role Context Preservation
 *     description: Rotates refresh token and returns a new Access Token and Refresh Token pair. Detects reuse attacks.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *               activeRole:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tokens rotated successfully.
 *       401:
 *         description: Invalid, expired, or compromised refresh token.
 */
router.post('/refresh', validateRequest(refreshTokenSchema), authController.refresh);

/**
 * @openapi
 * /api/v1/auth/switch-role:
 *   post:
 *     summary: Switch Active Role Context
 *     description: Switches the authenticated user's operational role context to another role assigned to their account. Issues a new signed access token with activeRole.
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
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
 *                 example: PARTNER
 *     responses:
 *       200:
 *         description: Role switched successfully. Returns new access token and role operational status.
 *       400:
 *         description: Invalid role name or missing body.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Requested role is not assigned to this account.
 */
router.post(
  '/switch-role',
  requireAuth,
  validateRequest(switchRoleSchema),
  authController.switchRole
);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout from Current Device
 *     description: Revokes the active session associated with the current bearer access token.
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully.
 *       401:
 *         description: Unauthorized.
 */
router.post('/logout', requireAuth, authController.logout);

/**
 * @openapi
 * /api/v1/auth/logout-all:
 *   post:
 *     summary: Logout from All Devices
 *     description: Revokes all active sessions for the authenticated user across all devices.
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All sessions revoked successfully.
 *       401:
 *         description: Unauthorized.
 */
router.post('/logout-all', requireAuth, authController.logoutAll);

/**
 * @openapi
 * /api/v1/auth/me:
 *   get:
 *     summary: Get Current Authenticated User Profile
 *     description: Returns detailed profile, assigned roles, active role, and current session information.
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved.
 *       401:
 *         description: Unauthorized.
 */
router.get('/me', requireAuth, authController.getMe);

// Role guard test endpoints
router.get(
  '/test/customer-only',
  requireAuth,
  requireCustomer,
  (_req, res) => {
    ApiResponse.success(res, { allowed: true, role: 'CUSTOMER' }, 'Customer access granted');
  }
);

router.get(
  '/test/admin-only',
  requireAuth,
  requireAdmin,
  (_req, res) => {
    ApiResponse.success(res, { allowed: true, role: 'ADMIN' }, 'Admin access granted');
  }
);

export const authRoutes = router;
