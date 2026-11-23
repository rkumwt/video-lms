import { zodResolver } from '@hookform/resolvers/zod';
import { type RecordingQuality, recordingQualitySchema, type RecordingType } from '@vlp/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  Circle,
  Loader2,
  MonitorPlay,
  Pause,
  Play,
  Square,
  Trash2,
  UserSquare2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LivePreview } from '@/features/record/media-preview';
import { isRecordingSupported } from '@/features/record/media';
import { useRecorder } from '@/features/record/use-recorder';
import { useSettings } from '@/features/settings/api';
import { type UploadProgress, uploadVideo } from '@/features/upload/upload-video';
import { videoKeys } from '@/features/videos/api';
import { formatBytes, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

const QUALITY_LABEL: Record<RecordingQuality, string> = {
  LOW: '720p',
  MEDIUM: '1080p',
  HIGH: '1440p',
};

const saveSchema = z.object({
  title: z.string().trim().min(1, 'Give your video a title').max(200),
  description: z.string().trim().max(5000).optional(),
});
type SaveValues = z.infer<typeof saveSchema>;

function defaultTitle() {
  return `Recording ${new Date().toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function RecordPage() {
  const settings = useSettings();
  const recorder = useRecorder();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Local choices start from Settings but can be changed per recording.
  const [mode, setMode] = useState<RecordingType | null>(null);
  const [mic, setMic] = useState<boolean | null>(null);
  const [quality, setQuality] = useState<RecordingQuality | null>(null);
  const s = settings.data?.settings;
  const effMode = mode ?? s?.defaultRecordingMode ?? 'SCREEN';
  const effMic = mic ?? s?.micEnabled ?? true;
  const effQuality = quality ?? s?.quality ?? 'MEDIUM';

  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const form = useForm<SaveValues>({
    resolver: zodResolver(saveSchema),
    defaultValues: { title: '', description: '' },
  });

  const { result, status } = recorder;
  const playbackUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => void (playbackUrl && URL.revokeObjectURL(playbackUrl)), [playbackUrl]);

  useEffect(() => {
    if (result) form.reset({ title: defaultTitle(), description: '' });
  }, [result, form]);

  // Don't lose a recording to an accidental tab close.
  const unsaved =
    status === 'recording' || status === 'paused' || (status === 'stopped' && !!result);
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  const save = async (values: SaveValues) => {
    if (!result) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setUpload({ loaded: 0, total: result.blob.size });
    try {
      await uploadVideo({
        file: result.blob,
        meta: {
          title: values.title,
          ...(values.description && { description: values.description }),
          recordingType: effMode,
          durationSec: result.durationSec,
        },
        onProgress: setUpload,
        signal: controller.signal,
      });
      await queryClient.invalidateQueries({ queryKey: videoKeys.all });
      recorder.reset();
      toast.success('Video saved');
      void navigate('/');
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === 'AbortError';
      toast[cancelled ? 'info' : 'error'](
        cancelled ? 'Upload cancelled' : `Upload failed: ${(err as Error).message}`,
      );
    } finally {
      setUpload(null);
      abortRef.current = null;
    }
  };

  if (!isRecordingSupported()) {
    return (
      <section className="mx-auto max-w-xl space-y-2 py-12 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Record</h1>
        <p role="alert" className="text-muted-foreground">
          Screen recording isn’t supported in this browser. Use a recent desktop version of Chrome,
          Edge, Firefox or Safari.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6" aria-labelledby="record-title">
      <div>
        <h1 id="record-title" className="text-2xl font-semibold tracking-tight">
          Record
        </h1>
        <p className="text-muted-foreground text-sm">
          Capture your screen{effMode === 'SCREEN_CAMERA' ? ' with your camera in the corner' : ''}
          {effMic ? ' and microphone' : ''}.
        </p>
      </div>

      {recorder.error && (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
        >
          {recorder.error}
        </p>
      )}

      {(status === 'idle' || status === 'requesting') && (
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>Defaults come from Settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <RadioGroup
              value={effMode}
              onValueChange={(v) => setMode(v as RecordingType)}
              className="grid gap-3 sm:grid-cols-2"
              aria-label="Recording mode"
            >
              {(
                [
                  ['SCREEN', 'Screen only', MonitorPlay],
                  ['SCREEN_CAMERA', 'Screen + camera', UserSquare2],
                ] as const
              ).map(([value, label, Icon]) => (
                <Label
                  key={value}
                  htmlFor={`rec-${value}`}
                  className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent flex cursor-pointer items-center gap-3 rounded-lg border p-4 font-normal"
                >
                  <RadioGroupItem id={`rec-${value}`} value={value} />
                  <Icon className="size-4" aria-hidden /> {label}
                </Label>
              ))}
            </RadioGroup>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Switch id="rec-mic" checked={effMic} onCheckedChange={setMic} />
                <Label htmlFor="rec-mic">Microphone</Label>
              </div>
              <div className="flex items-center gap-2" role="group" aria-label="Quality">
                {recordingQualitySchema.options.map((q) => (
                  <Button
                    key={q}
                    type="button"
                    size="sm"
                    variant={effQuality === q ? 'secondary' : 'ghost'}
                    aria-pressed={effQuality === q}
                    onClick={() => setQuality(q)}
                  >
                    {QUALITY_LABEL[q]}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={status === 'requesting'}
              onClick={() =>
                void recorder.start({ mode: effMode, quality: effQuality, micEnabled: effMic })
              }
            >
              {status === 'requesting' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Circle className="size-4 fill-current text-red-500" aria-hidden />
              )}
              Start recording
            </Button>
          </CardContent>
        </Card>
      )}

      {(status === 'recording' || status === 'paused') && (
        <Card className="overflow-hidden py-0">
          {recorder.preview && (
            <LivePreview stream={recorder.preview} className="aspect-video w-full bg-black" />
          )}
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="flex items-center gap-2 font-mono text-lg" aria-live="polite">
              <span
                className={cn(
                  'size-3 rounded-full',
                  status === 'recording' ? 'animate-pulse bg-red-500' : 'bg-amber-500',
                )}
                aria-hidden
              />
              {formatDuration(recorder.elapsedSec)}
              <span className="text-muted-foreground font-sans text-sm">
                {status === 'paused' ? 'Paused' : 'Recording'}
              </span>
            </p>
            <div className="flex gap-2">
              {status === 'recording' ? (
                <Button variant="outline" onClick={recorder.pause}>
                  <Pause className="size-4" aria-hidden /> Pause
                </Button>
              ) : (
                <Button variant="outline" onClick={recorder.resume}>
                  <Play className="size-4" aria-hidden /> Resume
                </Button>
              )}
              <Button variant="destructive" onClick={recorder.stop}>
                <Square className="size-4" aria-hidden /> Stop
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {status === 'stopped' && result && playbackUrl && (
        <Card className="overflow-hidden py-0">
          <video
            src={playbackUrl}
            controls
            playsInline
            className="aspect-video w-full bg-black"
            aria-label="Recording preview"
          />
          <CardContent className="space-y-4 p-4">
            <p className="text-muted-foreground text-sm">
              {formatDuration(result.durationSec)} · {formatBytes(result.blob.size)} ·{' '}
              {QUALITY_LABEL[effQuality]}
            </p>
            <form
              onSubmit={(e) => void form.handleSubmit(save)(e)}
              className="space-y-4"
              noValidate
            >
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  aria-invalid={!!form.formState.errors.title}
                  aria-describedby={form.formState.errors.title ? 'title-error' : undefined}
                  disabled={!!upload}
                  {...form.register('title')}
                />
                {form.formState.errors.title && (
                  <p id="title-error" className="text-destructive text-sm">
                    {form.formState.errors.title.message}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  rows={3}
                  disabled={!!upload}
                  {...form.register('description')}
                />
              </div>

              {upload && (
                <div className="space-y-1">
                  <Progress
                    value={(upload.loaded / Math.max(upload.total, 1)) * 100}
                    aria-label="Upload progress"
                  />
                  <p className="text-muted-foreground text-xs">
                    Uploading {formatBytes(upload.loaded)} of {formatBytes(upload.total)}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                {upload ? (
                  <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
                    Cancel upload
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" onClick={recorder.reset}>
                    <Trash2 className="size-4" aria-hidden /> Discard
                  </Button>
                )}
                <Button type="submit" disabled={!!upload}>
                  {upload && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Save video
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
