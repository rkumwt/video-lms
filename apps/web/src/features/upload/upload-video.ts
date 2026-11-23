import {
  type CreateUploadInput,
  createUploadResponseSchema,
  type UploadInstructions,
  type Video,
  videoSchema,
} from '@vlp/shared';
import { z } from 'zod';

import { apiFetch } from '@/lib/api-client';

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface UploadVideoOptions {
  file: Blob;
  meta: Omit<CreateUploadInput, 'mimeType' | 'sizeBytes'>;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  /** Parallel part uploads for multipart (browsers allow ~6 connections per host). */
  concurrency?: number;
  retries?: number;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/** XHR because fetch() still can't report upload progress in browsers. */
function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(body.size);
        resolve({ etag: xhr.getResponseHeader('ETag') });
      } else {
        reject(new UploadError(`Upload failed with HTTP ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const aborted = signal?.aborted || (err instanceof DOMException && err.name === 'AbortError');
      const clientError =
        err instanceof UploadError && err.status && err.status >= 400 && err.status < 500;
      if (aborted || clientError || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // 0.5s, 1s, 2s…
    }
  }
}

/** Sends the bytes as instructed by the API. Returns multipart completion data if any. */
async function sendBytes(
  upload: UploadInstructions,
  file: Blob,
  report: (loaded: number) => void,
  {
    signal,
    concurrency = 4,
    retries = 3,
  }: Pick<UploadVideoOptions, 'signal' | 'concurrency' | 'retries'>,
): Promise<{ uploadId?: string; parts?: { partNumber: number; etag: string }[] }> {
  if (upload.strategy !== 's3-multipart') {
    await withRetry(
      () => putWithProgress(upload.url, file, upload.headers, report, signal),
      retries,
      signal,
    );
    return {};
  }

  const { partSizeBytes, parts } = upload;
  const loadedPerPart = new Map<number, number>();
  const done: { partNumber: number; etag: string }[] = [];
  const queue = [...parts];

  const worker = async () => {
    for (let part = queue.shift(); part; part = queue.shift()) {
      const { partNumber, url } = part;
      const chunk = file.slice((partNumber - 1) * partSizeBytes, partNumber * partSizeBytes);
      const { etag } = await withRetry(
        () =>
          putWithProgress(
            url,
            chunk,
            {},
            (loaded) => {
              loadedPerPart.set(partNumber, loaded);
              report([...loadedPerPart.values()].reduce((a, b) => a + b, 0));
            },
            signal,
          ),
        retries,
        signal,
      );
      if (!etag) throw new UploadError('S3 did not expose the ETag header (check bucket CORS)');
      done.push({ partNumber, etag });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker));
  return { uploadId: upload.uploadId, parts: done.sort((a, b) => a.partNumber - b.partNumber) };
}

/**
 * 1) register the video, 2) send the bytes (S3 direct or API), 3) complete.
 * On failure or cancel, the server-side upload is aborted so nothing is left half-written.
 */
export async function uploadVideo({
  file,
  meta,
  onProgress,
  signal,
  ...opts
}: UploadVideoOptions): Promise<Video> {
  const mimeType = file.type || 'video/webm';
  const { video, upload } = await apiFetch('/api/v1/uploads', createUploadResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ ...meta, mimeType, sizeBytes: file.size }),
    signal,
  });

  const total = file.size;
  const report = (loaded: number) => onProgress?.({ loaded: Math.min(loaded, total), total });
  report(0);

  try {
    const completion = await sendBytes(upload, file, report, { signal, ...opts });
    const { video: done } = await apiFetch(
      `/api/v1/uploads/${video.id}/complete`,
      z.object({ video: videoSchema }),
      { method: 'POST', body: JSON.stringify(completion), signal },
    );
    return done;
  } catch (err) {
    const query =
      upload.strategy === 's3-multipart' ? `?uploadId=${encodeURIComponent(upload.uploadId)}` : '';
    // Best effort cleanup; keepalive lets it finish even if the user navigates away.
    void fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/v1/uploads/${video.id}${query}`, {
      method: 'DELETE',
      keepalive: true,
    }).catch(() => undefined);
    throw err;
  }
}
