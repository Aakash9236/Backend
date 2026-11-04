import request from 'supertest';
import app from '../src/app';

describe('Centralized Error Handling', () => {
  describe('404 Not Found', () => {
    it('should return 404 with standardized error response for unknown route', async () => {
      const response = await request(app).get('/api/v1/non-existent-endpoint');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Route not found');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Root Landing Endpoint', () => {
    it('should return welcome message and documentation links', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('docs', '/api-docs');
      expect(response.body.data).toHaveProperty('health', '/api/v1/health');
    });
  });
});

