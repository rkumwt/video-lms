import { describe, expect, it } from 'vitest';

import { makeVideo } from '@/test/render';

import { POLL_MS, pollInterval } from './api';

const page = (...statuses: string[]) => ({
  items: statuses.map((status, i) => makeVideo(i, { status })) as never,
  total: statuses.length,
  nextCursor: null,
});

describe('pollInterval', () => {
  it('polls while any video is still uploading or processing', () => {
    expect(pollInterval([page('READY', 'PROCESSING')])).toBe(POLL_MS);
    expect(pollInterval([page('READY'), page('UPLOADED')])).toBe(POLL_MS);
  });

  it('stops when every video is final (READY or FAILED) or nothing is loaded', () => {
    expect(pollInterval([page('READY', 'FAILED')])).toBe(false);
    expect(pollInterval([page()])).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });
});
