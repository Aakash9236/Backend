import { z } from 'zod';

const testEnvSchema = z.object({
  PORT: z.string().transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
});

describe('Environment Variable Validation', () => {
  it('should fail validation when DB_PASSWORD is missing', () => {
    const invalidEnv = {
      PORT: '5000',
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/db',
    };

    const result = testEnvSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('DB_PASSWORD');
    }
  });

  it('should fail validation when NODE_ENV is invalid', () => {
    const invalidEnv = {
      PORT: '5000',
      NODE_ENV: 'invalid_env',
      DB_PASSWORD: 'secret',
      DATABASE_URL: 'postgresql://localhost:5432/db',
    };

    const result = testEnvSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('should successfully parse valid configuration', () => {
    const validEnv = {
      PORT: '5000',
      NODE_ENV: 'development',
      DB_PASSWORD: 'secret',
      DATABASE_URL: 'postgresql://localhost:5432/db',
    };

    const result = testEnvSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(5000);
      expect(result.data.NODE_ENV).toBe('development');
    }
  });
});

