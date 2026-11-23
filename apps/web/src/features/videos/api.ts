import {
  type ListVideosQuery,
  type VideoListResponse,
  videoListResponseSchema,
  type VideoStatus,
} from '@vlp/shared';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api-client';

/** Statuses the worker will still change. */
const IN_PROGRESS = new Set<VideoStatus>(['UPLOADING', 'UPLOADED', 'PROCESSING']);
export const POLL_MS = 5_000;

/** Poll while any listed video is still being uploaded/processed; stop once all are final. */
export function pollInterval(pages: VideoListResponse[] | undefined): number | false {
  return pages?.some((p) => p.items.some((v) => IN_PROGRESS.has(v.status))) ? POLL_MS : false;
}

export const videoKeys = {
  all: ['videos'] as const,
  list: (limit: number) => [...videoKeys.all, 'list', { limit }] as const,
};

export function fetchVideos({ limit, cursor }: ListVideosQuery) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return apiFetch(`/api/v1/videos?${params.toString()}`, videoListResponseSchema);
}

/** Newest-first video list with "load more" (keyset pagination). */
export function useVideos(limit = 24) {
  return useInfiniteQuery({
    queryKey: videoKeys.list(limit),
    queryFn: ({ pageParam }) => fetchVideos({ limit, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Poll while the worker is still processing something; stop once everything is final.
    refetchInterval: (query) => pollInterval(query.state.data?.pages),
  });
}
