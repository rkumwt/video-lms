import { type ListVideosQuery, videoListResponseSchema } from '@vlp/shared';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api-client';

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
  });
}
