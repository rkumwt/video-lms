/**
 * Builds a PostgreSQL connection string.
 * - Local / CI: `DATABASE_URL`.
 * - AWS: discrete `DB_*` variables injected by ECS from the Secrets Manager secret, so the
 *   password never appears in a task definition, image, or log.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const { DB_HOST, DB_PORT = '5432', DB_NAME = 'postgres', DB_USER, DB_PASSWORD } = env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
    throw new Error('Database is not configured: set DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD');
  }
  const user = encodeURIComponent(DB_USER);
  const password = encodeURIComponent(DB_PASSWORD);
  return `postgresql://${user}:${password}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}
