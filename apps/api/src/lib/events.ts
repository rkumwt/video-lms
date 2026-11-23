import { logger } from './logger';

/**
 * Domain events for background processing. Phase 9 replaces the body with an SQS SendMessage
 * (the worker then generates a thumbnail and marks the video READY). Callers don't change.
 */
export const events = {
  videoUploaded(videoId: string): Promise<void> {
    logger.info({ videoId, event: 'video.uploaded' }, 'Video uploaded (queue not wired yet)');
    return Promise.resolve();
  },
};
