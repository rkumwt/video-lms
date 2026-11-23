import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadVideo } from './upload-video';

const video = (status: string) => ({
  id: '0190a000-0000-7000-8000-000000000001',
  title: 'Demo',
  description: null,
  recordingType: 'SCREEN',
  storageType: 'S3',
  thumbnailKey: null,
  durationSec: 3,
  sizeBytes: 10,
  mimeType: 'video/webm',
  status,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

interface Put {
  url: string;
  size: number;
  headers: Record<string, string>;
}
let puts: Put[] = [];
let failNext = 0;

class FakeXHR {
  status = 0;
  upload: { onprogress?: (e: { loaded: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private url = '';
  private headers: Record<string, string> = {};
  open(_m: string, url: string) {
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  getResponseHeader(name: string) {
    return name === 'ETag' ? `"etag-${this.url.split('part=')[1] ?? 'single'}"` : null;
  }
  abort() {
    this.onabort?.();
  }
  send(body: Blob) {
    queueMicrotask(() => {
      if (failNext > 0) {
        failNext--;
        this.onerror?.();
        return;
      }
      puts.push({ url: this.url, size: body.size, headers: this.headers });
      this.upload.onprogress?.({ loaded: body.size });
      this.status = 200;
      this.onload?.();
    });
  }
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function mockApi(upload: unknown) {
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
    if (url === '/api/v1/uploads' && init?.method === 'POST')
      return json({ video: video('UPLOADING'), upload, expiresAt: new Date().toISOString() }, 201);
    if (url.endsWith('/complete')) return json({ video: video('UPLOADED') });
    if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
    return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  puts = [];
  failNext = 0;
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const meta = { title: 'Demo', recordingType: 'SCREEN' as const, durationSec: 3 };

describe('uploadVideo', () => {
  it('uploads a small file with one presigned PUT and completes it', async () => {
    mockApi({
      strategy: 's3-single',
      url: 'https://s3/put',
      headers: { 'Content-Type': 'video/webm' },
    });
    const progress = vi.fn();
    const file = new Blob([new Uint8Array(10)], { type: 'video/webm' });

    const result = await uploadVideo({ file, meta, onProgress: progress });

    expect(result.status).toBe('UPLOADED');
    expect(puts).toEqual([
      { url: 'https://s3/put', size: 10, headers: { 'Content-Type': 'video/webm' } },
    ]);
    expect(progress).toHaveBeenLastCalledWith({ loaded: 10, total: 10 });
    const createBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<
      string,
      unknown
    >;
    expect(createBody).toMatchObject({ mimeType: 'video/webm', sizeBytes: 10, title: 'Demo' });
  });

  it('splits multipart uploads by part size, retries a failed part and sends sorted ETags', async () => {
    mockApi({
      strategy: 's3-multipart',
      uploadId: 'up-1',
      partSizeBytes: 4,
      parts: [1, 2, 3].map((n) => ({ partNumber: n, url: `https://s3/part?part=${n}` })),
    });
    failNext = 1; // first PUT fails with a network error, then succeeds on retry
    const file = new Blob([new Uint8Array(10)], { type: 'video/webm' });

    const promise = uploadVideo({ file, meta, concurrency: 2 });
    await vi.runAllTimersAsync();
    await promise;

    expect(puts.map((p) => p.size).sort()).toEqual([2, 4, 4]); // 4 + 4 + 2 bytes
    const complete = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/complete'))!;
    expect(JSON.parse(complete[1]!.body as string)).toEqual({
      uploadId: 'up-1',
      parts: [1, 2, 3].map((n) => ({ partNumber: n, etag: `"etag-${n}"` })),
    });
  });

  it('aborts the server-side upload when cancelled', async () => {
    mockApi({ strategy: 'local', url: '/api/v1/uploads/x/file', headers: {} });
    const controller = new AbortController();
    const file = new Blob([new Uint8Array(10)], { type: 'video/webm' });
    vi.stubGlobal(
      'XMLHttpRequest',
      class extends FakeXHR {
        override send() {
          controller.abort(); // user clicks Cancel mid-upload
        }
      },
    );

    await expect(uploadVideo({ file, meta, signal: controller.signal })).rejects.toThrow(
      /cancelled/,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/uploads\/0190a000-0000-7000-8000-000000000001$/),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
