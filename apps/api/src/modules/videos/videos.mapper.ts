import type { Video as VideoRow } from '@vlp/db';
import type { Video } from '@vlp/shared';

/** DB row → API DTO. Never leaks internal fields (storageKey) and makes BigInt/Date JSON-safe. */
export function toVideoDto(row: VideoRow): Video {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    recordingType: row.recordingType,
    storageType: row.storageType,
    thumbnailKey: row.thumbnailKey,
    durationSec: row.durationSec,
    sizeBytes: Number(row.sizeBytes),
    mimeType: row.mimeType,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
