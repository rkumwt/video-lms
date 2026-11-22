import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { healthBody, makeVideo, mockFetch, renderApp } from '@/test/render';

afterEach(() => vi.unstubAllGlobals());

describe('HomePage', () => {
  it('shows the total count and videos newest first', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/health') return { body: healthBody };
      if (url.pathname === '/api/v1/videos')
        return {
          body: {
            items: [makeVideo(1, { status: 'PROCESSING' }), makeVideo(2)],
            total: 2,
            nextCursor: null,
          },
        };
      return undefined;
    });
    renderApp('/');

    await waitFor(() => expect(screen.getByTestId('video-count')).toHaveTextContent('2 videos'));
    const cards = screen.getAllByTestId('video-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('Video 1')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Processing')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('1:15')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('shows an empty state with a call to action', async () => {
    mockFetch((url) =>
      url.pathname === '/api/v1/videos'
        ? { body: { items: [], total: 0, nextCursor: null } }
        : { body: healthBody },
    );
    renderApp('/');

    expect(await screen.findByText('No videos yet')).toBeInTheDocument();
    expect(screen.getByTestId('video-count')).toHaveTextContent('0 videos');
    expect(screen.getByRole('link', { name: /record your first video/i })).toHaveAttribute(
      'href',
      '/record',
    );
  });

  it('loads the next page with the cursor', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.pathname !== '/api/v1/videos') return { body: healthBody };
      return url.searchParams.get('cursor')
        ? { body: { items: [makeVideo(3)], total: 3, nextCursor: null } }
        : { body: { items: [makeVideo(1), makeVideo(2)], total: 3, nextCursor: makeVideo(2).id } };
    });
    renderApp('/');

    await userEvent.click(await screen.findByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getAllByTestId('video-card')).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`cursor=${makeVideo(2).id}`),
      expect.anything(),
    );
  });

  it('shows an error with retry when the API fails', async () => {
    let fail = true;
    mockFetch((url) => {
      if (url.pathname !== '/api/v1/videos') return { body: healthBody };
      return fail
        ? { status: 500, body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Boom' } } }
        : { body: { items: [makeVideo(1)], total: 1, nextCursor: null } };
    });
    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Video 1')).toBeInTheDocument();
  });
});
