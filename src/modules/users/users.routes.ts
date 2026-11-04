import { Router } from 'express';
import { usersController } from './users.controller';
import { requireAuth, validateRequest } from '../../common/middlewares';
import {
  updateUserSchema,
  createAddressSchema,
  updateAddressSchema,
} from './users.validator';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * @openapi
 * /api/v1/users/me:
 *   get:
 *     summary: Retrieve Authenticated User Profile
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile and role assignments.
 */
router.get('/me', usersController.getMe);

/**
 * @openapi
 * /api/v1/users/me:
 *   patch:
 *     summary: Update Permitted User Profile Information
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: User information updated.
 */
router.patch('/me', validateRequest(updateUserSchema), usersController.updateMe);

/**
 * @openapi
 * /api/v1/users/me/roles:
 *   get:
 *     summary: Get All Roles Assigned to Authenticated User
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Roles list.
 */
router.get('/me/roles', usersController.getMyRoles);

/**
 * @openapi
 * /api/v1/users/me:
 *   delete:
 *     summary: Safely Deactivate User Account
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account deactivated and sessions terminated.
 */
router.delete('/me', usersController.deactivateMe);

// Address Management
/**
 * @openapi
 * /api/v1/users/me/addresses:
 *   post:
 *     summary: Add New User Address
 *     tags:
 *       - Users
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
 *               - addressLine1
 *               - postalCode
 *               - latitude
 *               - longitude
 *             properties:
 *               cityId:
 *                 type: string
 *               areaId:
 *                 type: string
 *               addressType:
 *                 type: string
 *                 enum: [HOME, WORK, OTHER]
 *               addressLine1:
 *                 type: string
 *               addressLine2:
 *                 type: string
 *               landmark:
 *                 type: string
 *               postalCode:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Address created.
 */
router.post(
  '/me/addresses',
  validateRequest(createAddressSchema),
  usersController.createAddress
);

/**
 * @openapi
 * /api/v1/users/me/addresses:
 *   get:
 *     summary: List User Addresses
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User addresses list.
 */
router.get('/me/addresses', usersController.getAddresses);

/**
 * @openapi
 * /api/v1/users/me/addresses/{id}:
 *   get:
 *     summary: Get Specific User Address
 *     tags:
 *       - Users
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
 *         description: Address details.
 */
router.get('/me/addresses/:id', usersController.getAddressById);

/**
 * @openapi
 * /api/v1/users/me/addresses/{id}:
 *   patch:
 *     summary: Update User Address
 *     tags:
 *       - Users
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
 *         description: Address updated.
 */
router.patch(
  '/me/addresses/:id',
  validateRequest(updateAddressSchema),
  usersController.updateAddress
);

/**
 * @openapi
 * /api/v1/users/me/addresses/{id}:
 *   delete:
 *     summary: Delete User Address
 *     tags:
 *       - Users
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
 *         description: Address deleted.
 */
router.delete('/me/addresses/:id', usersController.deleteAddress);

/**
 * @openapi
 * /api/v1/users/me/addresses/{id}/default:
 *   patch:
 *     summary: Set Address as Default
 *     tags:
 *       - Users
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
 *         description: Default address updated.
 */
router.patch('/me/addresses/:id/default', usersController.setDefaultAddress);

export const userRoutes = router;

