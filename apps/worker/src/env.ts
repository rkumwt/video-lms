import { z } from 'zod';

const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().default('dev'),
  AWS_REGION: z.string().default('ap-south-1'),

  /** Unset = the worker idles (local dev without LocalStack). */
  VIDEO_EVENTS_QUEUE_URL: unsetIfEmpty(z.url().optional()),
  SQS_ENDPOINT: unsetIfEmpty(z.url().optional()),
  /** Messages processed in parallel (each worker task). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  /** Must match the queue's redrive maxReceiveCount (infra: 5). On the last attempt we mark FAILED. */
  MAX_RECEIVE_COUNT: z.coerce.number().int().min(1).default(5),

  VIDEOS_BUCKET: unsetIfEmpty(z.string().min(3).optional()),
  S3_ENDPOINT: unsetIfEmpty(z.url().optional()),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console -- logger depends on env, so it isn't available yet
  console.error('Invalid environment variables:', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
