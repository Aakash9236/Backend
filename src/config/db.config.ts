import { PrismaClient } from '@prisma/client';
import { env } from './env.config';
import { logger } from './logger.config';

declare global {
  // Prevent multiple instances of Prisma Client in development hot-reloading
  // eslint-disable-next-line no-var
  var __prismaInstance: PrismaClient | undefined;
}

export const prisma =
  global.__prismaInstance ||
  new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });

if (env.NODE_ENV === 'development') {
  global.__prismaInstance = prisma;

  // Optional: log queries in debug mode
  (prisma as any).$on('error', (e: any) => {
    logger.error(`Prisma Error: ${e.message}`);
  });
}

/**
 * Checks database connectivity by executing a fast read-only probe
 */
export async function checkDatabaseConnection(): Promise<{ connected: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    // Read-only ping without modifying or writing any data
    await prisma.$queryRawUnsafe('SELECT 1');
    const latencyMs = Date.now() - start;
    return { connected: true, latencyMs };
  } catch (error: any) {
    const latencyMs = Date.now() - start;
    logger.error(`Database connectivity check failed: ${error.message}`);
    return { connected: false, latencyMs, error: 'Database unreachable' };
  }
}

/**
 * Disconnect Prisma gracefully
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Prisma database client disconnected gracefully.');
  } catch (err: any) {
    logger.error(`Error disconnecting Prisma: ${err.message}`);
  }
}

