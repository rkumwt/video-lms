import { vi } from 'vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '@/routes';

/** Renders the real route table at `path` with a fresh, retry-free QueryClient. */
export function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return {
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

type Handler = (url: URL) => { status?: number; body: unknown } | undefined;

/** Stubs global fetch with a tiny URL router; unmatched URLs return 404. */
export function mockFetch(handler: Handler) {
  const fn = vi.fn((input: RequestInfo | URL) => {
    const raw = input instanceof Request ? input.url : input.toString();
    const url = new URL(raw, 'http://localhost');
    const res = handler(url) ?? {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'x' } },
    };
    return Promise.resolve(
      new Response(JSON.stringify(res.body), {
        status: res.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const healthBody = {
  status: 'ok',
  service: 'api',
  version: 'test123',
  uptimeSec: 1,
  timestamp: new Date().toISOString(),
};

export function makeVideo(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    title: `Video ${n}`,
    description: null,
    recordingType: 'SCREEN',
    storageType: 'S3',
    thumbnailKey: null,
    durationSec: 75,
    sizeBytes: 1536,
    mimeType: 'video/webm',
    status: 'READY',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
