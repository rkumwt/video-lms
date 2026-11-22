import { healthResponseSchema, readinessResponseSchema } from '@vlp/shared';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app';

const queryRaw = vi.fn();
vi.mock('./lib/db', () => ({
  getDb: () => ({ $queryRaw: queryRaw }),
  disconnectDb: vi.fn(),
}));

const app = createApp();

describe('GET /health', () => {
  it('returns a valid health payload', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(healthResponseSchema.parse(res.body).status).toBe('ok');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('is also exposed under /api/health', async () => {
    await request(app).get('/api/health').expect(200);
  });
});

describe('unknown routes', () => {
  it('return the standard error envelope', async () => {
    const res = await request(app).get('/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('GET /health/ready', () => {
  it('is 200 when the database answers', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app).get('/api/health/ready').expect(200);
    expect(readinessResponseSchema.parse(res.body).checks.database).toBe('ok');
  });

  it('is 503 when the database is down', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/health/ready').expect(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'error' } });
  });
});
