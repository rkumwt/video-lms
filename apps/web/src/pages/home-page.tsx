import { healthResponseSchema } from '@vlp/shared';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';

export function HomePage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health', healthResponseSchema),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Learning Video Platform</h1>
      <p className="text-muted-foreground">Hello world. Record, store and watch learning videos.</p>

      <div className="rounded-lg border px-4 py-3 text-sm" data-testid="api-status">
        {health.isPending && <span>Checking API…</span>}
        {health.isError && <span className="text-destructive">API unreachable</span>}
        {health.isSuccess && (
          <span>
            API <strong>{health.data.status}</strong> · v{health.data.version}
          </span>
        )}
      </div>

      <Button onClick={() => void health.refetch()} disabled={health.isFetching}>
        Recheck API
      </Button>
    </main>
  );
}
