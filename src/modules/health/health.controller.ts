import { Request, Response } from 'express';
import { ApiResponse } from '../../common/utils/api-response.util';
import { checkDatabaseConnection } from '../../config/db.config';
import { getRedisStatus } from '../../config/redis.config';
import { env } from '../../config/env.config';

export class HealthController {
  /**
   * System health status endpoint
   * GET /api/v1/health
   */
  public static async getSystemHealth(_req: Request, res: Response): Promise<Response> {
    const memoryUsage = process.memoryUsage();
    const redisStatus = getRedisStatus();

    const healthData = {
      status: 'UP',
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100,
          heapTotalMb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 100) / 100,
          heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 100) / 100,
        },
      },
      services: {
        redis: {
          status: redisStatus.available ? 'CONNECTED' : 'DISCONNECTED_OR_DISABLED',
          note: redisStatus.available
            ? 'Operating with active Redis cache/geo capabilities.'
            : 'Running in optional degraded mode without local Redis.',
        },
      },
    };

    return ApiResponse.success(res, healthData, 'System service is healthy', 200);
  }

  /**
   * PostgreSQL database connectivity health check
   * GET /api/v1/health/database
   */
  public static async getDatabaseHealth(_req: Request, res: Response): Promise<Response> {
    const dbCheck = await checkDatabaseConnection();

    if (dbCheck.connected) {
      return ApiResponse.success(
        res,
        {
          status: 'CONNECTED',
          databaseEngine: 'PostgreSQL 18',
          latencyMs: dbCheck.latencyMs,
          checkedAt: new Date().toISOString(),
        },
        'Database connection probe succeeded',
        200
      );
    }

    return ApiResponse.error(
      res,
      'Database service is currently unreachable',
      503,
      {
        status: 'DISCONNECTED',
        latencyMs: dbCheck.latencyMs,
        checkedAt: new Date().toISOString(),
      }
    );
  }
}

