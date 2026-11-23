import { z } from 'zod';

// Mirrors the Prisma enums in packages/db/prisma/schema.prisma (kept separate so the browser
// bundle never depends on Prisma). A test in @vlp/db asserts they stay in sync.
export const recordingTypeSchema = z.enum(['SCREEN', 'SCREEN_CAMERA']);
export const storageTypeSchema = z.enum(['LOCAL', 'S3']);
export const videoStatusSchema = z.enum(['UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED']);
export const recordingQualitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export type RecordingType = z.infer<typeof recordingTypeSchema>;
export type StorageType = z.infer<typeof storageTypeSchema>;
export type VideoStatus = z.infer<typeof videoStatusSchema>;
export type RecordingQuality = z.infer<typeof recordingQualitySchema>;

/** Video as returned by the API (sizeBytes is a JSON number; safe up to ~9 PB). */
export const videoSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  recordingType: recordingTypeSchema,
  storageType: storageTypeSchema,
  thumbnailKey: z.string().nullable(),
  durationSec: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string(),
  status: videoStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Video = z.infer<typeof videoSchema>;

export const settingsSchema = z.object({
  storageTarget: storageTypeSchema,
  defaultRecordingMode: recordingTypeSchema,
  quality: recordingQualitySchema,
  micEnabled: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = settingsSchema.omit({ updatedAt: true }).partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/** GET /api/v1/videos query. Cursor = id of the last item of the previous page. */
export const listVideosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.uuid().optional(),
});
export type ListVideosQuery = z.infer<typeof listVideosQuerySchema>;

export const videoListResponseSchema = z.object({
  items: z.array(videoSchema),
  /** Total number of videos (for the "N videos" counter), independent of paging. */
  total: z.number().int().nonnegative(),
  nextCursor: z.uuid().nullable(),
});
export type VideoListResponse = z.infer<typeof videoListResponseSchema>;

/** GET/PUT /api/v1/settings */
export const settingsResponseSchema = z.object({
  settings: settingsSchema,
  /** Storage targets this server can actually use (LOCAL is off on AWS). */
  availableStorage: z.array(storageTypeSchema).min(1),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/** Capture presets for each quality level (used by the recorder). */
export const QUALITY_PRESETS = {
  LOW: { width: 1280, height: 720, frameRate: 30, videoBitsPerSecond: 2_500_000 },
  MEDIUM: { width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 5_000_000 },
  HIGH: { width: 2560, height: 1440, frameRate: 30, videoBitsPerSecond: 8_000_000 },
} as const satisfies Record<RecordingQuality, object>;
