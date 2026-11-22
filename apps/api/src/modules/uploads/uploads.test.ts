import { createUploadResponseSchema, videoDetailResponseSchema } from '@vlp/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };
const rows = new Map<string, Row>();
const settings = { id: 1, storageTarget: 'LOCAL' };

vi.mock('../../lib/db', () => ({
  getDb: () => ({
    setting: { findUnique: () => Promise.resolve(settings) },
    video: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      create: ({ data }: { data: Row }) => {
        const row = { thumbnailKey: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(data.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = { ...rows.get(where.id)!, ...data, updatedAt: new Date() };
        rows.set(where.id, row);
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
        return Promise.resolve({});
      },
    },
  }),
  disconnectDb: vi.fn(),
}));

const { createApp } = await import('../../app');
const { env } = await import('../../config/env');
const { rm } = await import('node:fs/promises');
const app = createApp();

const body = {
  title: 'My recording',
  recordingType: 'SCREEN',
  mimeType: 'video/webm;codecs=vp9',
  sizeBytes: 11,
  durationSec: 3,
};

beforeEach(() => rows.clear());
afterAll(() => rm(env.LOCAL_STORAGE_DIR, { recursive: true, force: true }));

describe('LOCAL upload flow', () => {
  it('create → PUT file → complete → detail → ranged stream', async () => {
    const created = createUploadResponseSchema.parse(
      (await request(app).post('/api/v1/uploads').send(body).expect(201)).body,
    );
    expect(created.video.status).toBe('UPLOADING');
    expect(created.upload.strategy).toBe('local');
    const { id } = created.video;

    // Playback isn't available before completion.
    const before = videoDetailResponseSchema.parse(
      (await request(app).get(`/api/v1/videos/${id}`).expect(200)).body,
    );
    expect(before.playbackUrl).toBeNull();

    await request(app)
      .put(`/api/v1/uploads/${id}/file`)
      .set('Content-Type', 'video/webm')
      .send(Buffer.from('hello world'))
      .expect(204);

    const done = await request(app).post(`/api/v1/uploads/${id}/complete`).send({}).expect(200);
    expect((done.body as { video: { status: string } }).video.status).toBe('UPLOADED');

    // Completing twice is a no-op.
    await request(app).post(`/api/v1/uploads/${id}/complete`).send({}).expect(200);

    const detail = videoDetailResponseSchema.parse(
      (await request(app).get(`/api/v1/videos/${id}`).expect(200)).body,
    );
    expect(detail.playbackUrl).toBe(`/api/v1/videos/${id}/stream`);

    const ranged = await request(app)
      .get(`/api/v1/videos/${id}/stream`)
      .set('Range', 'bytes=0-4')
      .expect(206);
    expect(ranged.headers['content-type']).toMatch(/^video\/webm/);
    expect(ranged.headers['content-range']).toBe('bytes 0-4/11');
  });

  it('refuses to complete before the file exists', async () => {
    const created = (await request(app).post('/api/v1/uploads').send(body).expect(201)).body as {
      video: { id: string };
    };
    const res = await request(app).post(`/api/v1/uploads/${created.video.id}/complete`).send({});
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('UPLOAD_INCOMPLETE');
  });

  it('rejects a body larger than declared (413) and allows cancelling', async () => {
    const created = (await request(app).post('/api/v1/uploads').send(body).expect(201)).body as {
      video: { id: string };
    };
    const id = created.video.id;
    await request(app)
      .put(`/api/v1/uploads/${id}/file`)
      .set('Content-Type', 'video/webm')
      .send(Buffer.alloc(100))
      .expect(413);
    await request(app).delete(`/api/v1/uploads/${id}`).expect(204);
    await request(app).get(`/api/v1/videos/${id}`).expect(404);
  });

  it('returns 503 when S3 is requested but not configured', async () => {
    const res = await request(app)
      .post('/api/v1/uploads')
      .send({ ...body, storageType: 'S3' });
    expect(res.status).toBe(503);
    expect(rows.size).toBe(0);
  });

  it('validates the payload', async () => {
    await request(app)
      .post('/api/v1/uploads')
      .send({ ...body, mimeType: 'application/pdf' })
      .expect(400);
  });
});
