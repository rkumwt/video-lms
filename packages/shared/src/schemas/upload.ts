import { z } from 'zod';

import { recordingTypeSchema, storageTypeSchema, videoSchema } from './video';

/** Hard cap for a single recording (also enforced server-side by env UPLOAD_MAX_BYTES). */
export const MAX_UPLOAD_BYTES = 10 * 1024 ** 3; // 10 GiB

/** MediaRecorder produces e.g. "video/webm;codecs=vp9,opus". */
export const videoMimeTypeSchema = z
  .string()
  .max(100)
  .regex(/^video\/(webm|mp4)(;.*)?$/i, 'Only video/webm and video/mp4 are supported');

/** POST /api/v1/uploads: register a video and get upload instructions. */
export const createUploadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  recordingType: recordingTypeSchema,
  mimeType: videoMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  durationSec: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 3600),
  /** Omit to use the storage target from Settings. */
  storageType: storageTypeSchema.optional(),
});
export type CreateUploadInput = z.infer<typeof createUploadSchema>;

const presignedPartSchema = z.object({ partNumber: z.number().int().min(1), url: z.url() });

/**
 * How the browser should send the bytes:
 * - `s3-single`:    one presigned PUT straight to S3 (small files).
 * - `s3-multipart`: presigned PUT per part (parallel, resumable), then complete with ETags.
 * - `local`:        PUT the raw file to the API, which writes it to disk (dev / self-hosted).
 */
export const uploadInstructionsSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('s3-single'),
    url: z.url(),
    headers: z.record(z.string(), z.string()),
  }),
  z.object({
    strategy: z.literal('s3-multipart'),
    uploadId: z.string(),
    partSizeBytes: z.number().int().positive(),
    parts: z.array(presignedPartSchema).min(1),
  }),
  z.object({
    strategy: z.literal('local'),
    url: z.string().startsWith('/'),
    headers: z.record(z.string(), z.string()),
  }),
]);
export type UploadInstructions = z.infer<typeof uploadInstructionsSchema>;

export const createUploadResponseSchema = z.object({
  video: videoSchema,
  upload: uploadInstructionsSchema,
  /** Presigned URLs stop working after this time. */
  expiresAt: z.iso.datetime(),
});
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;

/** POST /api/v1/uploads/:id/complete */
export const completeUploadSchema = z.object({
  /** Required for `s3-multipart`: echo back `upload.uploadId`. */
  uploadId: z.string().min(1).optional(),
  /** Required for `s3-multipart`: the ETag S3 returned for each part. */
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) }))
    .optional(),
});
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

export const videoIdParamsSchema = z.object({ id: z.uuid() });

/** GET /api/v1/videos/:id */
export const videoDetailResponseSchema = z.object({
  video: videoSchema,
  /** Short-lived URL to play/download the file; null until the upload has completed. */
  playbackUrl: z.string().nullable(),
});
export type VideoDetailResponse = z.infer<typeof videoDetailResponseSchema>;
