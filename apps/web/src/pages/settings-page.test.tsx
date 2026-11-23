import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { healthBody, mockFetch, renderApp } from '@/test/render';

const settingsBody = (micEnabled = true) => ({
  settings: {
    storageTarget: 'S3',
    defaultRecordingMode: 'SCREEN',
    quality: 'MEDIUM',
    micEnabled,
    updatedAt: new Date().toISOString(),
  },
  availableStorage: ['S3'],
});

afterEach(() => vi.unstubAllGlobals());

describe('SettingsPage', () => {
  it('loads settings, disables unavailable storage and saves changes', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.pathname === '/api/v1/settings') {
        // GET returns mic on; PUT echoes the saved value.
        if (init?.method === 'PUT') {
          const sent = JSON.parse(init.body as string) as { micEnabled: boolean };
          return { body: settingsBody(sent.micEnabled) };
        }
        return { body: settingsBody(true) };
      }
      return { body: healthBody };
    });
    renderApp('/settings');

    const mic = await screen.findByRole('switch', { name: /microphone/i });
    expect(mic).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /local disk/i })).toBeDisabled();
    expect(screen.getByText('Not available on this server.')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: /save settings/i });
    expect(save).toBeDisabled(); // nothing changed yet

    await userEvent.click(mic);
    await userEvent.click(save);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/settings',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1]!.body as string)).toMatchObject({
      micEnabled: false,
      quality: 'MEDIUM',
    });
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('vlp-settings')!)).toMatchObject({
      settings: { micEnabled: false },
    });
  });
});
