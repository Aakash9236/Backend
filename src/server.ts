import app from './app';
import { env } from './config/env.config';
import { logger } from './config/logger.config';
import { checkDatabaseConnection, disconnectDatabase } from './config/db.config';
import { initializeRedis, disconnectRedis } from './config/redis.config';
import { ensureSeedLocations } from './common/utils/seed-locations.util';
import http from 'http';

const server = http.createServer(app);

async function bootstrap() {
  try {
    logger.info('====================================================');
    logger.info('Starting Multi-Service On-Demand Platform Backend...');
    logger.info(`Environment: ${env.NODE_ENV}`);
    logger.info('====================================================');

    // 1. Verify PostgreSQL Database Connectivity
    logger.info('Verifying PostgreSQL database connectivity...');
    const dbStatus = await checkDatabaseConnection();
    if (dbStatus.connected) {
      logger.info(`PostgreSQL database connected successfully (Latency: ${dbStatus.latencyMs}ms).`);
      // Ensure seed cities & areas exist
      await ensureSeedLocations();
    } else {
      logger.error('Initial database connectivity check failed. Check database credentials or status.');
    }

    // 2. Initialize Optional Redis Connection
    logger.info('Probing local Redis cache...');
    await initializeRedis();

    // 3. Start HTTP Server
    server.listen(env.PORT, () => {
      logger.info(`Server listening on http://localhost:${env.PORT}`);
      logger.info(`Interactive API Docs available at http://localhost:${env.PORT}/api-docs`);
      logger.info(`Health check available at http://localhost:${env.PORT}/api/v1/health`);
    });
  } catch (error: any) {
    logger.error(`Fatal bootstrap error: ${error.message}`, { stack: error.stack });
    process.exit(1);
  }
}

// Graceful Shutdown Handler
async function gracefulShutdown(signal: string) {
  logger.warn(`Received ${signal}. Initiating graceful shutdown...`);

  // Stop accepting new HTTP requests
  server.close(async () => {
    logger.info('HTTP server closed.');

    // Disconnect resources
    await disconnectDatabase();
    await disconnectRedis();

    logger.info('Graceful shutdown complete. Exiting process.');
    process.exit(0);
  });

  // Force shutdown after timeout if hanging
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run bootstrap
bootstrap();

