import { z } from 'zod';

/**
 * Messages on the video-events queue (API → worker). Versioned and discriminated by `type` so new
 * events (e.g. `video.transcribe.requested` in Stage 2) can be added without breaking consumers.
 */
export const videoUploadedEventSchema = z.object({
  type: z.literal('video.uploaded'),
  version: z.literal(1),
  videoId: z.uuid(),
  occurredAt: z.iso.datetime(),
});

export const videoEventSchema = z.discriminatedUnion('type', [videoUploadedEventSchema]);
export type VideoEvent = z.infer<typeof videoEventSchema>;
