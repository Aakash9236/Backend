import { Router } from 'express';
import { customersController } from './customers.controller';
import { requireAuth, validateRequest } from '../../common/middlewares';
import {
  customerProfileSchema,
  updateCustomerProfileSchema,
} from './customers.validator';

const router = Router();

// All routes require authenticated user
router.use(requireAuth);

/**
 * @openapi
 * /api/v1/customers/profile:
 *   get:
 *     summary: Retrieve Authenticated User's Customer Profile
 *     tags:
 *       - Customers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer profile details.
 */
router.get('/profile', customersController.getProfile);

/**
 * @openapi
 * /api/v1/customers/profile:
 *   post:
 *     summary: Create or Replace Customer Profile
 *     tags:
 *       - Customers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
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
 *               profileImageUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile saved.
 */
router.post(
  '/profile',
  validateRequest(customerProfileSchema),
  customersController.createProfile
);

/**
 * @openapi
 * /api/v1/customers/profile:
 *   patch:
 *     summary: Update Customer Profile Details
 *     tags:
 *       - Customers
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
 *               profileImageUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated.
 */
router.patch(
  '/profile',
  validateRequest(updateCustomerProfileSchema),
  customersController.updateProfile
);

export const customerRoutes = router;

