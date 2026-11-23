import { zodResolver } from '@hookform/resolvers/zod';
import {
  type RecordingQuality,
  recordingQualitySchema,
  recordingTypeSchema,
  storageTypeSchema,
} from '@vlp/shared';
import { Cloud, HardDrive, Loader2, MonitorPlay, UserSquare2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSettings, useUpdateSettings } from '@/features/settings/api';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  storageTarget: storageTypeSchema,
  defaultRecordingMode: recordingTypeSchema,
  quality: recordingQualitySchema,
  micEnabled: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const QUALITY_LABELS: Record<RecordingQuality, string> = {
  LOW: '720p: smaller files',
  MEDIUM: '1080p: recommended',
  HIGH: '1440p: sharpest text',
};

const STORAGE = {
  S3: {
    label: 'Cloud (Amazon S3)',
    icon: Cloud,
    hint: 'Durable, uploads directly from your browser.',
  },
  LOCAL: {
    label: 'Local disk',
    icon: HardDrive,
    hint: 'Saved on the API server. For development.',
  },
} as const;

const MODES = {
  SCREEN: { label: 'Screen only', icon: MonitorPlay },
  SCREEN_CAMERA: { label: 'Screen + camera', icon: UserSquare2 },
} as const;

function OptionCard({
  id,
  value,
  disabled,
  children,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" />
      <div className="space-y-1">{children}</div>
    </Label>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  // Load server values into the form (and again after saving), without clobbering edits mid-typing.
  const server = settings.data?.settings;
  useEffect(() => {
    if (server && !form.formState.isDirty) {
      form.reset({
        storageTarget: server.storageTarget,
        defaultRecordingMode: server.defaultRecordingMode,
        quality: server.quality,
        micEnabled: server.micEnabled,
      });
    }
  }, [server, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values);
      form.reset(saved.settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings');
    }
  });

  if (!server) {
    return settings.isError ? (
      <p role="alert" className="text-destructive">
        Couldn’t load settings. {settings.error.message}
      </p>
    ) : (
      <div className="text-muted-foreground flex items-center gap-2" aria-busy="true">
        <Loader2 className="size-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  const available = settings.data?.availableStorage ?? [];

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="mx-auto max-w-2xl space-y-6" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Defaults for new recordings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>Where new recordings are saved.</CardDescription>
        </CardHeader>
        <CardContent>
          <Controller
            control={form.control}
            name="storageTarget"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid gap-3 sm:grid-cols-2"
                aria-label="Storage target"
              >
                {storageTypeSchema.options.map((value) => {
                  const { label, icon: Icon, hint } = STORAGE[value];
                  const disabled = !available.includes(value);
                  return (
                    <OptionCard
                      key={value}
                      id={`storage-${value}`}
                      value={value}
                      disabled={disabled}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Icon className="size-4" aria-hidden /> {label}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {disabled ? 'Not available on this server.' : hint}
                      </span>
                    </OptionCard>
                  );
                })}
              </RadioGroup>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recording</CardTitle>
          <CardDescription>You can still change these on the Record page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Controller
            control={form.control}
            name="defaultRecordingMode"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid gap-3 sm:grid-cols-2"
                aria-label="Default recording mode"
              >
                {recordingTypeSchema.options.map((value) => {
                  const { label, icon: Icon } = MODES[value];
                  return (
                    <OptionCard key={value} id={`mode-${value}`} value={value}>
                      <span className="flex items-center gap-2 font-medium">
                        <Icon className="size-4" aria-hidden /> {label}
                      </span>
                    </OptionCard>
                  );
                })}
              </RadioGroup>
            )}
          />

          <div className="grid gap-2">
            <Label htmlFor="quality">Quality</Label>
            <Controller
              control={form.control}
              name="quality"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="quality" className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {recordingQualitySchema.options.map((q) => (
                      <SelectItem key={q} value={q}>
                        {QUALITY_LABELS[q]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <Label htmlFor="mic">Microphone</Label>
              <p className="text-muted-foreground text-xs">Record your voice by default.</p>
            </div>
            <Controller
              control={form.control}
              name="micEnabled"
              render={({ field }) => (
                <Switch id="mic" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={!form.formState.isDirty || update.isPending}
          onClick={() => form.reset()}
        >
          Discard
        </Button>
        <Button type="submit" disabled={!form.formState.isDirty || update.isPending}>
          {update.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save settings
        </Button>
      </div>
    </form>
  );
}
