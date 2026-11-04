import { Router } from 'express';
import { healthRoutes } from '../modules/health/health.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { userRoutes } from '../modules/users/users.routes';
import { customerRoutes } from '../modules/customers/customers.routes';
import { partnerRoutes } from '../modules/partners/partners.routes';
import { adminRoutes } from '../modules/admin/admin.routes';
import { locationRoutes } from '../modules/locations/locations.routes';
import { vehicleRoutes, adminVehicleRoutes } from '../modules/vehicles';

const router = Router();

// API V1 Base Router
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/customers', customerRoutes);
router.use('/partners/vehicles', vehicleRoutes);
router.use('/partners', partnerRoutes);
router.use('/admin/vehicles', adminVehicleRoutes);
router.use('/admin', adminRoutes);
router.use('/locations', locationRoutes);
router.use('/vehicles', vehicleRoutes);

export const apiV1Routes = router;
