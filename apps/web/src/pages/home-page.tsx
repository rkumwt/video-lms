import { AlertCircle, Video } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { useVideos } from '@/features/videos/api';
import { VideoCard } from '@/features/videos/components/video-card';
import { VideoGridSkeleton } from '@/features/videos/components/video-grid-skeleton';
import { pluralize } from '@/lib/format';

export function HomePage() {
  const videos = useVideos();
  const items = videos.data?.pages.flatMap((p) => p.items) ?? [];
  const total = videos.data?.pages[0]?.total;

  return (
    <section aria-labelledby="home-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="home-title" className="text-2xl font-semibold tracking-tight">
            Your videos
          </h1>
          <p className="text-muted-foreground text-sm" data-testid="video-count">
            {total === undefined ? ' ' : pluralize(total, 'video')}
          </p>
        </div>
        <Button asChild>
          <Link to="/record">
            <Video className="size-4" aria-hidden /> New recording
          </Link>
        </Button>
      </div>

      {videos.isPending && <VideoGridSkeleton />}

      {videos.isError && (
        <div
          role="alert"
          className="border-destructive/40 text-destructive flex items-center gap-3 rounded-lg border p-4"
        >
          <AlertCircle className="size-5 shrink-0" aria-hidden />
          <p className="flex-1 text-sm">Couldn’t load your videos. {videos.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void videos.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {videos.isSuccess && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <Video className="text-muted-foreground size-10" aria-hidden />
          <h2 className="text-lg font-medium">No videos yet</h2>
          <p className="text-muted-foreground max-w-sm text-sm">
            Record your screen, optionally with your camera and microphone, and it will show up
            here.
          </p>
          <Button asChild>
            <Link to="/record">Record your first video</Link>
          </Button>
        </div>
      )}

      {items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((video) => (
            <li key={video.id}>
              <VideoCard video={video} />
            </li>
          ))}
        </ul>
      )}

      {videos.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void videos.fetchNextPage()}
            disabled={videos.isFetchingNextPage}
          >
            {videos.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </section>
  );
}
