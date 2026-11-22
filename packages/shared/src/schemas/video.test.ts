import { describe, expect, it } from 'vitest';

import { listVideosQuerySchema } from './video';

describe('listVideosQuerySchema', () => {
  it('applies defaults and coerces strings from the query string', () => {
    expect(listVideosQuerySchema.parse({})).toEqual({ limit: 24 });
    expect(listVideosQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
  });

  it('rejects out-of-range limits and malformed cursors', () => {
    expect(listVideosQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listVideosQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listVideosQuerySchema.safeParse({ cursor: 'nope' }).success).toBe(false);
  });
});
