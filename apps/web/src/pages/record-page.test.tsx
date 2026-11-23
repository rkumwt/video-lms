import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { healthBody, mockFetch, renderApp } from '@/test/render';

const uploadVideo = vi.fn();
vi.mock('@/features/upload/upload-video', () => ({
  uploadVideo: (...args: unknown[]) => uploadVideo(...args) as unknown,
}));

class FakeTrack {
  kind: string;
  private listeners: Record<string, (() => void)[]> = {};
  constructor(kind: string) {
    this.kind = kind;
  }
  stop = vi.fn();
  getSettings() {
    return { width: 1920, height: 1080 };
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t === 'video/webm;codecs=vp8,opus';
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'video/webm;codecs=vp8,opus';
  ondataavailable?: (e: { data: Blob }) => void;
  onstop?: () => void;
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function installMedia() {
  const getUserMedia = vi.fn((_c: MediaStreamConstraints) =>
    Promise.resolve(new FakeStream([new FakeTrack('audio')])),
  );
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeStream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia: vi.fn(() => Promise.resolve(new FakeStream([new FakeTrack('video')]))),
      getUserMedia,
    },
  });
  URL.createObjectURL = vi.fn(() => 'blob:recording');
  URL.revokeObjectURL = vi.fn();
  return { getUserMedia };
}

const settingsBody = {
  settings: {
    storageTarget: 'S3',
    defaultRecordingMode: 'SCREEN',
    quality: 'MEDIUM',
    micEnabled: true,
    updatedAt: new Date().toISOString(),
  },
  availableStorage: ['S3'],
};

beforeEach(() => {
  uploadVideo.mockReset();
  mockFetch((url) => {
    if (url.pathname === '/api/v1/settings') return { body: settingsBody };
    if (url.pathname === '/api/v1/videos')
      return { body: { items: [], total: 0, nextCursor: null } };
    return { body: healthBody };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('RecordPage', () => {
  it('explains when the browser cannot record the screen', () => {
    renderApp('/record');
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t supported in this browser/);
  });

  it('records, validates the title and uploads, then returns home', async () => {
    const media = installMedia();
    uploadVideo.mockImplementation(({ onProgress }: { onProgress: (p: unknown) => void }) => {
      onProgress({ loaded: 2048, total: 2048 });
      return Promise.resolve({});
    });
    renderApp('/record');

    await userEvent.click(await screen.findByRole('button', { name: /start recording/i }));
    expect(await screen.findByText('Recording')).toBeInTheDocument();
    // Mic is on by default (from Settings), so the microphone is requested.
    expect(media.getUserMedia.mock.calls[0]![0].audio).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(screen.getByText('Paused')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /stop/i }));

    const title = await screen.findByLabelText('Title');
    expect((title as HTMLInputElement).value).toMatch(/^Recording /);

    await userEvent.clear(title);
    await userEvent.click(screen.getByRole('button', { name: /save video/i }));
    expect(await screen.findByText('Give your video a title')).toBeInTheDocument();
    expect(uploadVideo).not.toHaveBeenCalled();

    await userEvent.type(title, 'My lesson');
    await userEvent.click(screen.getByRole('button', { name: /save video/i }));

    await waitFor(() => expect(uploadVideo).toHaveBeenCalledTimes(1));
    const call = uploadVideo.mock.calls[0]![0] as { file: Blob; meta: Record<string, unknown> };
    expect(call.file.size).toBe(2048);
    expect(call.meta).toMatchObject({ title: 'My lesson', recordingType: 'SCREEN' });
    expect(await screen.findByRole('heading', { name: 'Your videos' })).toBeInTheDocument();
  });
});
