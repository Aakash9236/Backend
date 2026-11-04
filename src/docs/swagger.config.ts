import swaggerJsdoc from 'swagger-jsdoc';
import { env } from '../config/env.config';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Multi-Service On-Demand Platform API',
    version: '1.0.0',
    description:
      'Production-quality Modular Monolith Backend supporting Customer, Partner, Admin, Home Shifting, Vehicle Booking, and On-Demand Home Services.',
    contact: {
      name: 'Platform Engineering Team',
    },
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT Access Token',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT Access Token',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation successful' },
          data: { type: 'object' },
          meta: { type: 'object' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Error message' },
          data: { type: 'object' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  tags: [
    { name: 'Health', description: 'System & Database connectivity endpoints' },
    { name: 'Authentication', description: 'Mobile OTP Authentication & Session Lifecycle' },
    { name: 'Users', description: 'User account management & addresses' },
    { name: 'Customers', description: 'Customer profiles and personal details' },
    { name: 'Partners', description: 'Partner onboarding, skills, service areas & KYC documents' },
    { name: 'Admin', description: 'Admin partner approval, document verification & audit trails' },
    { name: 'Vehicles', description: 'Fleet management, vehicle registration & KYC documents' },
    { name: 'Locations', description: 'Operational cities and serviceable areas' },
  ],
};

const options: swaggerJsdoc.Options = {
  swaggerDefinition,
  apis: [
    './src/routes/**/*.ts',
    './src/modules/**/*.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
