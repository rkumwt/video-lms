import type { Db } from '@vlp/db';
import type { VideoEvent } from '@vlp/shared';

import type { Logger } from '../logger';

export interface ProcessorDeps {
  db: Pick<Db, 'video'>;
  /** Confirms the uploaded object exists in S3 (throws/false if missing). */
  s3ObjectExists: (key: string) => Promise<boolean>;
  logger: Logger;
}

type UploadedEvent = Extract<VideoEvent, { type: 'video.uploaded' }>;

/**
 * UPLOADED → PROCESSING → READY. Idempotent: SQS is at-least-once, so the same event may arrive twice.
 * Thumbnails / transcoding / transcription plug in between PROCESSING and READY later.
 */
export async function processVideoUploaded(
  event: UploadedEvent,
  deps: ProcessorDeps,
): Promise<void> {
  const { db, logger } = deps;
  const log = logger.child({ videoId: event.videoId });

  const video = await db.video.findUnique({ where: { id: event.videoId } });
  if (!video) {
    log.warn('Video no longer exists (deleted?): nothing to do');
    return;
  }
  if (video.status === 'READY' || video.status === 'FAILED') {
    log.info({ status: video.status }, 'Already processed: skipping duplicate event');
    return;
  }
  if (video.status === 'UPLOADING') {
    // Event arrived before the DB commit was visible, or a bogus event: retry later.
    throw new Error('Video is still UPLOADING');
  }

  await db.video.update({ where: { id: video.id }, data: { status: 'PROCESSING' } });

  if (video.storageType === 'S3' && !(await deps.s3ObjectExists(video.storageKey))) {
    throw new Error(`Object ${video.storageKey} not found in S3`);
  }
  // LOCAL files live on the API host's disk; the worker trusts the API's size check.

  await db.video.update({ where: { id: video.id }, data: { status: 'READY' } });
  log.info('Video is READY');
}

/** Called when the final allowed attempt fails (the message is about to go to the DLQ). */
export async function markVideoFailed(videoId: string, deps: Pick<ProcessorDeps, 'db' | 'logger'>) {
  const { count } = await deps.db.video.updateMany({
    where: { id: videoId, status: { notIn: ['READY', 'FAILED'] } },
    data: { status: 'FAILED' },
  });
  if (count) deps.logger.error({ videoId }, 'Video marked FAILED after final retry');
}
