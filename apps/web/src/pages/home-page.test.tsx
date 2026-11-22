import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HomePage } from './home-page';

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HomePage />
    </QueryClientProvider>,
  );
}

describe('HomePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows API status when healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'ok',
            service: 'api',
            version: '1.2.3',
            uptimeSec: 1,
            timestamp: new Date().toISOString(),
          }),
          { status: 200 },
        ),
      ),
    );
    renderWithClient();
    expect(screen.getByRole('heading', { name: /learning video platform/i })).toBeInTheDocument();
    expect(await screen.findByText(/v1\.2\.3/)).toBeInTheDocument();
  });

  it('shows an error when API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    renderWithClient();
    expect(await screen.findByText(/api unreachable/i)).toBeInTheDocument();
  });
});
