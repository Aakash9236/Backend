import { Router } from 'express';
import { HealthController } from './health.controller';

const router = Router();

/**
 * @openapi
 * /api/v1/health:
 *   get:
 *     summary: System Health Check
 *     description: Returns overall system status, uptime, memory, and services availability.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: System is healthy.
 */
router.get('/', HealthController.getSystemHealth);

/**
 * @openapi
 * /api/v1/health/database:
 *   get:
 *     summary: Database Health Check
 *     description: Runs a fast probe against PostgreSQL 18 to verify database connectivity.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Database is connected and reachable.
 *       503:
 *         description: Database is unreachable.
 */
router.get('/database', HealthController.getDatabaseHealth);

export const healthRoutes = router;

