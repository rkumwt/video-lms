import type { Readable } from 'node:stream';

import type {
  CompleteUploadInput,
  CreateUploadInput,
  CreateUploadResponse,
  Video,
} from '@vlp/shared';
import { v7 as uuidv7 } from 'uuid';

import { env } from '../../config/env';
import { getDb } from '../../lib/db';
import { events } from '../../lib/events';
import { HttpError } from '../../lib/http-error';
import { getStorage, videoObjectKey } from '../../lib/storage';
import { toVideoDto } from '../videos/videos.mapper';

const DONE = new Set(['UPLOADED', 'PROCESSING', 'READY']);

async function findVideo(id: string) {
  const video = await getDb().video.findUnique({ where: { id } });
  if (!video) throw HttpError.notFound('Video not found');
  return video;
}

export const uploadsService = {
  /** Step 1: register the video (status UPLOADING) and return upload instructions. */
  async create(input: CreateUploadInput): Promise<CreateUploadResponse> {
    if (input.sizeBytes > env.UPLOAD_MAX_BYTES) {
      throw new HttpError(
        413,
        'PAYLOAD_TOO_LARGE',
        `Max upload size is ${env.UPLOAD_MAX_BYTES} bytes`,
      );
    }
    const db = getDb();
    const storageType =
      input.storageType ??
      (await db.setting.findUnique({ where: { id: 1 } }))?.storageTarget ??
      'S3';
    const storage = getStorage(storageType); // throws if that target isn't available

    const id = uuidv7(); // time-ordered, matches the DB default
    const key = videoObjectKey(id, input.mimeType);

    const video = await db.video.create({
      data: {
        id,
        title: input.title,
        description: input.description ?? null,
        recordingType: input.recordingType,
        storageType,
        storageKey: key,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        durationSec: input.durationSec,
        status: 'UPLOADING',
      },
    });

    try {
      const upload = await storage.startUpload({
        videoId: id,
        key,
        contentType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });
      const expiresAt = new Date(Date.now() + env.UPLOAD_URL_TTL_SEC * 1000).toISOString();
      return { video: toVideoDto(video), upload, expiresAt };
    } catch (err) {
      await db.video.delete({ where: { id } }); // don't leave an orphan row behind
      throw err;
    }
  },

  /** LOCAL only: stream the request body to disk. */
  async receiveFile(id: string, body: Readable): Promise<void> {
    const video = await findVideo(id);
    if (video.storageType !== 'LOCAL')
      throw HttpError.badRequest('This video is not stored locally');
    if (video.status !== 'UPLOADING') throw HttpError.conflict(`Video is already ${video.status}`);
    await getStorage('LOCAL').writeStream(video.storageKey, body, Number(video.sizeBytes));
  },

  /** Step 2: verify the bytes are there, mark UPLOADED and hand off to the worker. Idempotent. */
  async complete(id: string, input: CompleteUploadInput): Promise<Video> {
    const video = await findVideo(id);
    if (DONE.has(video.status)) return toVideoDto(video);
    if (video.status === 'FAILED') throw HttpError.conflict('Upload has failed; start a new one');

    const { sizeBytes } = await getStorage(video.storageType).completeUpload({
      key: video.storageKey,
      expectedSizeBytes: Number(video.sizeBytes),
      uploadId: input.uploadId,
      parts: input.parts,
    });

    const updated = await getDb().video.update({
      where: { id },
      data: { status: 'UPLOADED', sizeBytes: BigInt(sizeBytes) },
    });
    await events.videoUploaded(id);
    return toVideoDto(updated);
  },

  /** Cancel an in-progress upload: remove partial data and the row. */
  async abort(id: string, uploadId?: string): Promise<void> {
    const video = await findVideo(id);
    if (video.status !== 'UPLOADING')
      throw HttpError.conflict('Only in-progress uploads can be cancelled');
    await getStorage(video.storageType).abortUpload(video.storageKey, uploadId);
    await getDb().video.delete({ where: { id } });
  },
};
