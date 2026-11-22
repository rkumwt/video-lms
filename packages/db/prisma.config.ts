import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI config (migrate, generate, studio).
 *
 * Locally: DATABASE_URL from packages/db/.env (see .env.example).
 * On AWS (migration task): DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD are injected from Secrets
 * Manager, and TLS is verified against the RDS CA bundle baked into the image (DB_SSL_CA).
 */
function databaseUrl(): string {
  const env = process.env;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.DB_HOST) return 'postgresql://placeholder:placeholder@localhost:5432/placeholder'; // generate only

  const user = encodeURIComponent(env.DB_USER ?? '');
  const password = encodeURIComponent(env.DB_PASSWORD ?? '');
  const base = `postgresql://${user}:${password}@${env.DB_HOST}:${env.DB_PORT ?? '5432'}/${env.DB_NAME ?? 'postgres'}`;
  // Prisma's schema engine reads only the first certificate in `sslcert`, so prefer a single-CA file.
  const ca = env.PRISMA_SSL_CA ?? env.DB_SSL_CA;
  return ca ? `${base}?sslmode=require&sslaccept=strict&sslcert=${encodeURIComponent(ca)}` : base;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: databaseUrl() },
});
