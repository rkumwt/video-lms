import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('accepts a valid payload', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'api',
      version: '0.0.0',
      uptimeSec: 1.5,
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid status', () => {
    const result = healthResponseSchema.safeParse({ status: 'down' });
    expect(result.success).toBe(false);
  });
});
