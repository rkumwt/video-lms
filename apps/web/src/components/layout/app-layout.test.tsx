import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useThemeStore } from '@/stores/theme-store';
import { healthBody, mockFetch, renderApp } from '@/test/render';

beforeEach(() => {
  mockFetch((url) =>
    url.pathname === '/api/v1/videos'
      ? { body: { items: [], total: 0, nextCursor: null } }
      : { body: healthBody },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('AppLayout', () => {
  it('renders Home, Record and Settings navigation and marks the active page', async () => {
    renderApp('/settings');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const name of ['Home', 'Record', 'Settings']) {
      expect(screen.getAllByRole('link', { name }).some((l) => nav.contains(l))).toBe(true);
    }
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(await screen.findByText('API vtest123')).toBeInTheDocument();
  });

  it('navigates between pages', async () => {
    renderApp('/');
    await userEvent.click(screen.getByRole('link', { name: 'Record' }));
    expect(await screen.findByRole('heading', { name: 'Record' })).toBeInTheDocument();
  });

  it('shows a 404 page for unknown routes', () => {
    renderApp('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('applies the dark theme to <html>', async () => {
    renderApp('/');
    useThemeStore.getState().setTheme('dark');
    await vi.waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    useThemeStore.getState().setTheme('light');
    await vi.waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
  });
});
