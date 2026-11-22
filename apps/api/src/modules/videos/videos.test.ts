import { apiErrorSchema, videoListResponseSchema } from '@vlp/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app';

const findMany = vi.fn();
const count = vi.fn();
vi.mock('../../lib/db', () => ({
  getDb: () => ({
    video: { findMany, count },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  }),
  disconnectDb: vi.fn(),
}));

const row = (n: number) => ({
  id: `0190a000-0000-7000-8000-00000000000${n}`,
  title: `Video ${n}`,
  description: null,
  recordingType: 'SCREEN',
  storageType: 'S3',
  storageKey: `videos/${n}.webm`,
  thumbnailKey: null,
  durationSec: 60 * n,
  sizeBytes: BigInt(3_000_000_000 + n),
  mimeType: 'video/webm',
  status: 'READY',
  createdAt: new Date(Date.UTC(2026, 10, 20 - n)),
  updatedAt: new Date(Date.UTC(2026, 10, 20 - n)),
});

const app = createApp();

describe('GET /api/v1/videos', () => {
  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
  });

  it('returns newest-first items, total and a next cursor', async () => {
    findMany.mockResolvedValueOnce([row(1), row(2), row(3)]);
    count.mockResolvedValueOnce(7);

    const res = await request(app).get('/api/v1/videos?limit=2').expect(200);
    const body = videoListResponseSchema.parse(res.body);

    expect(body.total).toBe(7);
    expect(body.items.map((v) => v.title)).toEqual(['Video 1', 'Video 2']);
    expect(body.nextCursor).toBe(row(2).id);
    expect(body.items[0]!.sizeBytes).toBe(3_000_000_001); // BigInt serialised as number
    expect((res.body as { items: unknown[] }).items[0]).not.toHaveProperty('storageKey'); // internal field not exposed
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    );
  });

  it('continues from a cursor and reports the last page', async () => {
    findMany.mockResolvedValueOnce([row(3)]);
    count.mockResolvedValueOnce(3);

    const res = await request(app)
      .get(`/api/v1/videos?limit=2&cursor=${row(2).id}`)
      .expect(200);

    expect((res.body as { nextCursor: string | null }).nextCursor).toBeNull();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: row(2).id }, skip: 1 }),
    );
  });

  it('rejects invalid query parameters with the error envelope', async () => {
    const res = await request(app).get('/api/v1/videos?limit=500').expect(400);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('BAD_REQUEST');
    expect(findMany).not.toHaveBeenCalled();
  });
});
