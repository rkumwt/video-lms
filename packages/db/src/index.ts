import { readFileSync } from 'node:fs';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';
export { databaseUrlFromEnv } from './url';

import { databaseUrlFromEnv } from './url';

export interface CreateDbOptions {
  /** Max connections per process. Keep small: db.t4g.micro allows ~80 in total. */
  poolSize?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Creates a Prisma client backed by node-postgres (driver adapter, no Rust query engine).
 * One client per process; call `$disconnect()` on shutdown.
 */
export function createDb({ poolSize = 5, env = process.env }: CreateDbOptions = {}): PrismaClient {
  const caPath = env.DB_SSL_CA;
  const adapter = new PrismaPg({
    connectionString: databaseUrlFromEnv(env),
    max: poolSize,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // On AWS: verify the RDS certificate against Amazon's CA bundle shipped in the image.
    ...(caPath && { ssl: { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true } }),
  });
  return new PrismaClient({ adapter });
}

export type Db = PrismaClient;
