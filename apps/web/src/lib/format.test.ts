import { describe, expect, it } from 'vitest';

import { formatBytes, formatDuration, formatRelativeTime, pluralize } from './format';

describe('format helpers', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3_000_000_000)).toBe('2.8 GB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });

  it('formatRelativeTime', () => {
    const now = Date.UTC(2026, 0, 10, 12);
    expect(formatRelativeTime(new Date(now - 30_000).toISOString(), now)).toBe('just now');
    expect(formatRelativeTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe('3 hours ago');
    expect(formatRelativeTime(new Date(now - 24 * 3600_000).toISOString(), now)).toBe('yesterday');
  });

  it('pluralize', () => {
    expect(pluralize(1, 'video')).toBe('1 video');
    expect(pluralize(1200, 'video')).toBe('1,200 videos');
  });
});
