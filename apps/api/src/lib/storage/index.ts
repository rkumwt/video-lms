import type { StorageType } from '@vlp/shared';

import { env } from '../../config/env';
import { LocalStorage } from './local-storage';
import { S3Storage } from './s3-storage';
import { type StorageDriver, StorageError, type WritableStorage } from './types';

export * from './types';

let s3: S3Storage | undefined;
let local: LocalStorage | undefined;

export function getStorage(type: 'LOCAL'): WritableStorage;
export function getStorage(type: StorageType): StorageDriver;
export function getStorage(type: StorageType): StorageDriver {
  if (type === 'S3') {
    if (!env.VIDEOS_BUCKET) {
      throw new StorageError(
        'S3 storage is not configured (VIDEOS_BUCKET is unset)',
        'NOT_CONFIGURED',
      );
    }
    s3 ??= new S3Storage({
      bucket: env.VIDEOS_BUCKET,
      region: env.AWS_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      urlTtlSec: env.UPLOAD_URL_TTL_SEC,
      multipartThresholdBytes: env.MULTIPART_THRESHOLD_BYTES,
      partSizeBytes: env.MULTIPART_PART_SIZE_BYTES,
    });
    return s3;
  }
  if (!env.STORAGE_LOCAL_ENABLED) {
    throw new StorageError('Local storage is disabled on this server', 'DISABLED');
  }
  local ??= new LocalStorage(env.LOCAL_STORAGE_DIR);
  return local;
}

/** Storage key layout: one folder per video, so thumbnails/transcripts can sit next to it later. */
export function videoObjectKey(videoId: string, mimeType: string): string {
  const ext = /mp4/i.test(mimeType) ? 'mp4' : 'webm';
  return `videos/${videoId}/original.${ext}`;
}
