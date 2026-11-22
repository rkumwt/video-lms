import { healthResponseSchema } from '@vlp/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';

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
