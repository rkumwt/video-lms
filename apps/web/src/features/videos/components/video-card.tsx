import type { Video, VideoStatus } from '@vlp/shared';
import { MonitorPlay, UserSquare2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatBytes, formatDuration, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS: Record<VideoStatus, { label: string; className: string }> = {
  UPLOADING: {
    label: 'Uploading',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  UPLOADED: { label: 'Uploaded', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  PROCESSING: {
    label: 'Processing',
    className: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  },
  READY: { label: 'Ready', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  FAILED: { label: 'Failed', className: 'bg-destructive/15 text-destructive' },
};

export function VideoCard({ video }: { video: Video }) {
  const status = STATUS[video.status];
  const Icon = video.recordingType === 'SCREEN_CAMERA' ? UserSquare2 : MonitorPlay;

  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid="video-card">
      <div className="from-muted to-secondary relative flex aspect-video items-center justify-center bg-gradient-to-br">
        <Icon className="text-muted-foreground/60 size-10" aria-hidden />
        <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-xs text-white">
          {formatDuration(video.durationSec)}
        </span>
      </div>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 leading-snug font-medium" title={video.title}>
            {video.title}
          </h3>
          <Badge variant="secondary" className={cn('shrink-0 border-0', status.className)}>
            {status.label}
          </Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          <time dateTime={video.createdAt} title={new Date(video.createdAt).toLocaleString()}>
            {formatRelativeTime(video.createdAt)}
          </time>
          {' · '}
          {formatBytes(video.sizeBytes)}
          {' · '}
          {video.recordingType === 'SCREEN_CAMERA' ? 'Screen + camera' : 'Screen'}
        </p>
      </CardContent>
    </Card>
  );
}
