import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { UploadInstructions } from '@vlp/shared';

import {
  type CompleteUploadParams,
  type StartUploadParams,
  StorageError,
  type WritableStorage,
} from './types';

/**
 * Stores files on the API host's disk. Bytes flow browser → API → disk (streamed, never buffered).
 * Intended for local development and single-host installs; disabled on Fargate (ephemeral disk).
 */
export class LocalStorage implements WritableStorage {
  readonly type = 'LOCAL' as const;

  constructor(private readonly rootDir: string) {}

  /** Maps a storage key to a path, refusing anything that escapes the storage root. */
  resolvePath(key: string): string {
    const full = resolve(this.rootDir, key);
    const rel = relative(this.rootDir, full);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(full) === this.rootDir) {
      throw new StorageError('Invalid storage key', 'NOT_FOUND');
    }
    return full;
  }

  startUpload({ videoId, contentType }: StartUploadParams): Promise<UploadInstructions> {
    return Promise.resolve({
      strategy: 'local',
      url: `/api/v1/uploads/${videoId}/file`,
      headers: { 'Content-Type': contentType },
    });
  }

  async writeStream(key: string, body: Readable, maxBytes: number): Promise<{ sizeBytes: number }> {
    const target = this.resolvePath(key);
    const tmp = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });

    let sizeBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes) {
          cb(
            new StorageError(`Upload exceeds the declared size of ${maxBytes} bytes`, 'TOO_LARGE'),
          );
          return;
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(body, limiter, createWriteStream(tmp));
      await rename(tmp, target); // atomic: readers never see a half-written file
      return { sizeBytes };
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async completeUpload({
    key,
    expectedSizeBytes,
  }: CompleteUploadParams): Promise<{ sizeBytes: number }> {
    try {
      const { size } = await stat(this.resolvePath(key));
      if (size !== expectedSizeBytes) {
        throw new StorageError(
          `Uploaded size ${size} does not match declared size ${expectedSizeBytes}`,
          'INCOMPLETE',
        );
      }
      return { sizeBytes: size };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError('The file has not been uploaded yet', 'INCOMPLETE');
    }
  }

  async abortUpload(key: string): Promise<void> {
    await this.deleteObject(key);
  }

  getPlaybackUrl(_key: string, videoId: string): Promise<string> {
    return Promise.resolve(`/api/v1/videos/${videoId}/stream`);
  }

  async deleteObject(key: string): Promise<void> {
    const path = this.resolvePath(key);
    await rm(path, { force: true });
    await rm(`${path}.part`, { force: true });
  }
}
