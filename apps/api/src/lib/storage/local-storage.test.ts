import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStorage } from './local-storage';

let dir: string;
let storage: LocalStorage;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vlp-local-'));
  storage = new LocalStorage(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('LocalStorage', () => {
  it('streams a body to disk atomically and completes when the size matches', async () => {
    const { sizeBytes } = await storage.writeStream(
      'videos/a/original.webm',
      Readable.from(['hello']),
      5,
    );
    expect(sizeBytes).toBe(5);
    expect(await readFile(join(dir, 'videos/a/original.webm'), 'utf8')).toBe('hello');
    await expect(
      storage.completeUpload({ key: 'videos/a/original.webm', expectedSizeBytes: 5 }),
    ).resolves.toEqual({
      sizeBytes: 5,
    });
  });

  it('aborts and leaves nothing behind when the body exceeds the declared size', async () => {
    await expect(
      storage.writeStream('videos/b/original.webm', Readable.from(['too long']), 3),
    ).rejects.toThrow(/exceeds/);
    await expect(stat(join(dir, 'videos/b/original.webm'))).rejects.toThrow();
    await expect(stat(join(dir, 'videos/b/original.webm.part'))).rejects.toThrow();
  });

  it('refuses keys that escape the storage root', () => {
    expect(() => storage.resolvePath('../../etc/passwd')).toThrow(/Invalid storage key/);
    expect(() => storage.resolvePath('videos/../../x')).toThrow(/Invalid storage key/);
  });
});
