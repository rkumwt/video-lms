import { resolve } from 'node:path';

import { MAX_UPLOAD_BYTES } from '@vlp/shared';
import { z } from 'zod';

const MiB = 1024 * 1024;

/** Treat `VAR=` (empty, common in .env files) as unset. */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  APP_VERSION: z.string().default(process.env.npm_package_version ?? '0.0.0'),

  // ---- Storage: S3 ---------------------------------------------------------------------------
  AWS_REGION: z.string().default('ap-south-1'),
  /** Unset = S3 storage disabled (e.g. local dev without LocalStack). */
  VIDEOS_BUCKET: unsetIfEmpty(z.string().min(3).optional()),
  /** LocalStack / MinIO endpoint for local development, e.g. http://localhost:4566 */
  S3_ENDPOINT: unsetIfEmpty(z.url().optional()),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  // ---- Queue ---------------------------------------------------------------------------------------
  /** Unset = events are only logged (local dev without LocalStack); videos stay UPLOADED. */
  VIDEO_EVENTS_QUEUE_URL: unsetIfEmpty(z.url().optional()),
  /** LocalStack endpoint for local development, e.g. http://localhost:4566 */
  SQS_ENDPOINT: unsetIfEmpty(z.url().optional()),

  // ---- Storage: local disk -----------------------------------------------------------------------
  /** Off in production: Fargate disks are ephemeral, so LOCAL is for dev / single-host installs. */
  STORAGE_LOCAL_ENABLED: unsetIfEmpty(z.stringbool().optional()),
  LOCAL_STORAGE_DIR: z
    .string()
    .default('storage')
    .transform((dir) => resolve(dir)),

  // ---- Uploads ---------------------------------------------------------------------------------
  UPLOAD_URL_TTL_SEC: z.coerce
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600)
    .default(3600),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES)
    .default(MAX_UPLOAD_BYTES),
  /** Files above this use S3 multipart upload (parallel, resumable parts). */
  MULTIPART_THRESHOLD_BYTES: z.coerce
    .number()
    .int()
    .min(5 * MiB)
    .default(64 * MiB),
  MULTIPART_PART_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(5 * MiB)
    .default(16 * MiB),
});

export type Env = Omit<z.infer<typeof envSchema>, 'STORAGE_LOCAL_ENABLED'> & {
  STORAGE_LOCAL_ENABLED: boolean;
};

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast: a misconfigured container should crash at boot, not at first request.
    // eslint-disable-next-line no-console -- logger depends on env, so it isn't available yet
    console.error('Invalid environment variables:', z.prettifyError(parsed.error));
    process.exit(1);
  }
  const data = parsed.data;
  return {
    ...data,
    STORAGE_LOCAL_ENABLED: data.STORAGE_LOCAL_ENABLED ?? data.NODE_ENV !== 'production',
  };
}

export const env = loadEnv();
