import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // PostgreSQL Database
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.string().default('5432').transform((val) => parseInt(val, 10)),
  DB_NAME: z.string().default('service_platform_db'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis Configuration (Optional / Local)
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.string().default('6379').transform((val) => parseInt(val, 10)),

  // Authentication & Secrets
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),

  // Mock OTP for Development
  MOCK_OTP_ENABLED: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),
  DEV_DEFAULT_OTP: z.string().default('123456'),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.format();
    const formattedErrors = Object.entries(errorDetails)
      .filter(([key]) => key !== '_errors')
      .map(([key, val]) => `${key}: ${(val as { _errors: string[] })._errors.join(', ')}`)
      .join('; ');
    throw new Error(`Environment Validation Error: ${formattedErrors}`);
  }
  return result.data;
};

export const env = parseEnv();
export type EnvConfig = z.infer<typeof envSchema>;

