import Redis from 'ioredis';
import { env } from './env.config';
import { logger } from './logger.config';

let redisClient: Redis | null = null;
let isRedisAvailable = false;

if (env.NODE_ENV !== 'test') {
  try {
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.warn(
            `[Redis] Local Redis server not reachable after ${times} attempts. Running in Redis-degraded mode. Redis features (caching, live geo-dispatch) are disabled.`
          );
          return null; // stop retrying
        }
        return Math.min(times * 200, 1000);
      },
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    redisClient.on('connect', () => {
      isRedisAvailable = true;
      logger.info(`[Redis] Connected successfully to Redis at ${env.REDIS_HOST}:${env.REDIS_PORT}`);
    });

    redisClient.on('error', (err) => {
      isRedisAvailable = false;
      // Do not crash the application; report warning
      logger.warn(`[Redis Notice] Local Redis unavailable (${err.message}). Application continues running normally.`);
    });
  } catch (error: any) {
    logger.warn(`[Redis Initialization] Skipped: ${error.message}`);
  }
}

/**
 * Connect to Redis gracefully on server startup
 */
export async function initializeRedis(): Promise<boolean> {
  if (!redisClient || env.NODE_ENV === 'test') {
    return false;
  }

  try {
    await redisClient.connect();
    isRedisAvailable = true;
    return true;
  } catch {
    isRedisAvailable = false;
    logger.warn('[Redis] Local Redis is offline. Backend running with Redis features disabled.');
    return false;
  }
}

/**
 * Returns Redis connection health status
 */
export function getRedisStatus(): { available: boolean; host: string; port: number } {
  return {
    available: isRedisAvailable,
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  };
}

/**
 * Disconnect Redis on application shutdown
 */
export async function disconnectRedis(): Promise<void> {
  if (redisClient && isRedisAvailable) {
    try {
      await redisClient.quit();
      logger.info('Redis client disconnected gracefully.');
    } catch {
      redisClient.disconnect();
    }
  }
}

export { redisClient, isRedisAvailable };

