import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console -- logger depends on env, so it isn't available yet
  console.error('Invalid environment variables:', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
