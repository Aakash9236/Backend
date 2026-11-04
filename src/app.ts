import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { requestLogger, errorHandler, notFoundHandler } from './common/middlewares';
import { apiV1Routes } from './routes';
import { swaggerSpec } from './docs/swagger.config';
import { ApiResponse } from './common/utils/api-response.util';

// Register global BigInt JSON serialization for PostgreSQL BIGINT primary keys
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app: Application = express();

// 1. Security Headers
app.use(helmet());

// 2. Cross-Origin Resource Sharing
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// 3. Request Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. HTTP Access Logging
app.use(requestLogger);

// 5. Swagger Interactive API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// 6. Root Landing Endpoint
app.get('/', (_req: Request, res: Response) => {
  return ApiResponse.success(
    res,
    {
      name: 'Multi-Service On-Demand Platform API',
      version: '1.0.0',
      docs: '/api-docs',
      health: '/api/v1/health',
    },
    'Welcome to the Multi-Service On-Demand Platform API Backend'
  );
});

// 7. Versioned API Routes (/api/v1)
app.use('/api/v1', apiV1Routes);

// 8. 404 Route Catch-All
app.use(notFoundHandler);

// 9. Centralized Error Handler
app.use(errorHandler);

export default app;
