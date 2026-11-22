import type { ListVideosQuery, VideoDetailResponse, VideoListResponse } from '@vlp/shared';

import { getDb } from '../../lib/db';
import { HttpError } from '../../lib/http-error';
import { getStorage } from '../../lib/storage';
import { toVideoDto } from './videos.mapper';

export const videosService = {
  /**
   * Newest first, keyset (cursor) pagination: stable under inserts and uses the
   * `createdAt DESC` index. `id` breaks ties between rows created in the same millisecond.
   */
  async list({ limit, cursor }: ListVideosQuery): Promise<VideoListResponse> {
    const db = getDb();
    const [rows, total] = await db.$transaction([
      db.video.findMany({
        take: limit + 1, // fetch one extra to know whether there is a next page
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      db.video.count(),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map(toVideoDto),
      total,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  },
};

const PLAYABLE = new Set(['UPLOADED', 'PROCESSING', 'READY']);

export const videoDetailService = {
  async get(id: string): Promise<VideoDetailResponse> {
    const video = await getDb().video.findUnique({ where: { id } });
    if (!video) throw HttpError.notFound('Video not found');
    const playbackUrl = PLAYABLE.has(video.status)
      ? await getStorage(video.storageType).getPlaybackUrl(
          video.storageKey,
          video.id,
          video.mimeType,
        )
      : null;
    return { video: toVideoDto(video), playbackUrl };
  },

  /** LOCAL only: absolute file path + mime type, for streaming with HTTP Range support. */
  async localFile(id: string): Promise<{ path: string; mimeType: string }> {
    const video = await getDb().video.findUnique({ where: { id } });
    if (!video || video.storageType !== 'LOCAL' || !PLAYABLE.has(video.status)) {
      throw HttpError.notFound('Video not found');
    }
    return { path: getStorage('LOCAL').resolvePath(video.storageKey), mimeType: video.mimeType };
  },
};
