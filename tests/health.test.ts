import request from 'supertest';
import app from '../src/app';
import { disconnectDatabase } from '../src/config/db.config';

describe('Health Check APIs', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('GET /api/v1/health', () => {
    it('should return 200 with system status UP and memory information', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'System service is healthy');
      expect(response.body.data).toHaveProperty('status', 'UP');
      expect(response.body.data).toHaveProperty('uptimeSeconds');
      expect(response.body.data.system).toHaveProperty('nodeVersion');
      expect(response.body.data.system.memory).toHaveProperty('heapUsedMb');
      expect(response.body.data.services).toHaveProperty('redis');
    });
  });

  describe('GET /api/v1/health/database', () => {
    it('should verify live PostgreSQL database connectivity and return 200', async () => {
      const response = await request(app).get('/api/v1/health/database');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('status', 'CONNECTED');
      expect(response.body.data).toHaveProperty('databaseEngine', 'PostgreSQL 18');
      expect(response.body.data).toHaveProperty('latencyMs');
      expect(typeof response.body.data.latencyMs).toBe('number');
    });
  });
});

