import type { StorageType, UploadInstructions } from '@vlp/shared';
import type { Readable } from 'node:stream';

export interface StartUploadParams {
  videoId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
}

export interface CompleteUploadParams {
  key: string;
  expectedSizeBytes: number;
  uploadId?: string;
  parts?: { partNumber: number; etag: string }[];
}

/**
 * One interface, two backends (S3, local disk). Adding e.g. GCS or Azure later means adding a
 * driver; the upload/video services don't change.
 */
export interface StorageDriver {
  readonly type: StorageType;
  /** Returns instructions for the browser to send the bytes. */
  startUpload(params: StartUploadParams): Promise<UploadInstructions>;
  /** Finalises the upload and returns the stored size in bytes. */
  completeUpload(params: CompleteUploadParams): Promise<{ sizeBytes: number }>;
  abortUpload(key: string, uploadId?: string): Promise<void>;
  /** URL the browser can play / download from. */
  getPlaybackUrl(key: string, videoId: string, contentType: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

/** Local driver only: receives the request body stream. */
export interface WritableStorage extends StorageDriver {
  writeStream(key: string, body: Readable, maxBytes: number): Promise<{ sizeBytes: number }>;
  resolvePath(key: string): string;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_CONFIGURED' | 'DISABLED' | 'INCOMPLETE' | 'TOO_LARGE' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
