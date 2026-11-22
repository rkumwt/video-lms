import type { ListVideosQuery, VideoListResponse } from '@vlp/shared';

import { getDb } from '../../lib/db';
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
