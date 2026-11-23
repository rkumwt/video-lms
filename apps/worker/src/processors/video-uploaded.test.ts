import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markVideoFailed, processVideoUploaded } from './video-uploaded';

const logger = pino({ level: 'silent' });
const event = {
  type: 'video.uploaded' as const,
  version: 1 as const,
  videoId: '0190a000-0000-7000-8000-000000000001',
  occurredAt: new Date().toISOString(),
};

let row: Record<string, unknown> | null;
const statuses: string[] = [];
const db = {
  video: {
    findUnique: vi.fn(() => Promise.resolve(row)),
    update: vi.fn(({ data }: { data: { status: string } }) => {
      statuses.push(data.status);
      row = { ...row, ...data };
      return Promise.resolve(row);
    }),
    updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
  },
};

beforeEach(() => {
  statuses.length = 0;
  vi.clearAllMocks();
  row = {
    id: event.videoId,
    status: 'UPLOADED',
    storageType: 'S3',
    storageKey: 'videos/x/original.webm',
  };
});

const deps = (exists = true) =>
  ({ db, logger, s3ObjectExists: vi.fn(() => Promise.resolve(exists)) }) as unknown as Parameters<
    typeof processVideoUploaded
  >[1];

describe('processVideoUploaded', () => {
  it('moves UPLOADED → PROCESSING → READY after confirming the S3 object', async () => {
    const d = deps(true);
    await processVideoUploaded(event, d);
    expect(statuses).toEqual(['PROCESSING', 'READY']);
    expect(d.s3ObjectExists).toHaveBeenCalledWith('videos/x/original.webm');
  });

  it('is idempotent for already-processed videos', async () => {
    row = { ...row, status: 'READY' };
    await processVideoUploaded(event, deps());
    expect(db.video.update).not.toHaveBeenCalled();
  });

  it('acknowledges events for deleted videos without doing anything', async () => {
    row = null;
    await expect(processVideoUploaded(event, deps())).resolves.toBeUndefined();
    expect(db.video.update).not.toHaveBeenCalled();
  });

  it('throws (so SQS retries) when the object is missing or the upload is not finished', async () => {
    await expect(processVideoUploaded(event, deps(false))).rejects.toThrow(/not found in S3/);
    row = { ...row, status: 'UPLOADING' };
    await expect(processVideoUploaded(event, deps())).rejects.toThrow(/still UPLOADING/);
  });

  it('skips the S3 check for LOCAL storage', async () => {
    row = { ...row, storageType: 'LOCAL' };
    const d = deps(false);
    await processVideoUploaded(event, d);
    expect(d.s3ObjectExists).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('READY');
  });
});

describe('markVideoFailed', () => {
  it('only fails videos that are not already final', async () => {
    await markVideoFailed(event.videoId, { db, logger } as never);
    expect(db.video.updateMany).toHaveBeenCalledWith({
      where: { id: event.videoId, status: { notIn: ['READY', 'FAILED'] } },
      data: { status: 'FAILED' },
    });
  });
});
