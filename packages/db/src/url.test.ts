import { describe, expect, it } from 'vitest';

import { databaseUrlFromEnv } from './url';

describe('databaseUrlFromEnv', () => {
  it('prefers DATABASE_URL', () => {
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgresql://a:b@h:1/d', DB_HOST: 'x' })).toBe(
      'postgresql://a:b@h:1/d',
    );
  });

  it('builds a URL from DB_* parts and encodes the password', () => {
    expect(
      databaseUrlFromEnv({
        DB_HOST: 'db.internal',
        DB_PORT: '5432',
        DB_NAME: 'vlp',
        DB_USER: 'vlp_admin',
        DB_PASSWORD: 'p@ss:w/rd#',
      }),
    ).toBe('postgresql://vlp_admin:p%40ss%3Aw%2Frd%23@db.internal:5432/vlp');
  });

  it('throws when nothing is configured', () => {
    expect(() => databaseUrlFromEnv({})).toThrow(/not configured/);
  });
});
