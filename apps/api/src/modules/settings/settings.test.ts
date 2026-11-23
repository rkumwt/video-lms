import { apiErrorSchema, settingsResponseSchema } from '@vlp/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let row = {
  id: 1,
  storageTarget: 'S3',
  defaultRecordingMode: 'SCREEN',
  quality: 'MEDIUM',
  micEnabled: true,
  updatedAt: new Date(),
};
const upsert = vi.fn(({ update }: { update: Partial<typeof row> }) => {
  row = { ...row, ...update, updatedAt: new Date() };
  return Promise.resolve(row);
});
vi.mock('../../lib/db', () => ({ getDb: () => ({ setting: { upsert } }), disconnectDb: vi.fn() }));

const { createApp } = await import('../../app');
const app = createApp();

beforeEach(() => {
  row = { ...row, storageTarget: 'S3', quality: 'MEDIUM', micEnabled: true };
});

describe('settings API (test env: LOCAL enabled, S3 not configured)', () => {
  it('reports only the storage targets this server can use', async () => {
    const body = settingsResponseSchema.parse(
      (await request(app).get('/api/v1/settings').expect(200)).body,
    );
    expect(body.availableStorage).toEqual(['LOCAL']);
    // The saved S3 target isn't usable here, so the effective target is LOCAL.
    expect(body.settings.storageTarget).toBe('LOCAL');
  });

  it('updates a subset of fields', async () => {
    const res = await request(app)
      .put('/api/v1/settings')
      .send({ quality: 'HIGH', micEnabled: false })
      .expect(200);
    const body = settingsResponseSchema.parse(res.body);
    expect(body.settings).toMatchObject({ quality: 'HIGH', micEnabled: false });
  });

  it('rejects an unavailable storage target and unknown fields', async () => {
    const res = await request(app)
      .put('/api/v1/settings')
      .send({ storageTarget: 'S3' })
      .expect(400);
    expect(apiErrorSchema.parse(res.body).error.message).toMatch(/not available/);
    await request(app).put('/api/v1/settings').send({ colour: 'red' }).expect(400);
  });
});
