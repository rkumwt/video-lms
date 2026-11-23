import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createDb } from '@vlp/db';

import { QueueConsumer } from './consumer';
import { env } from './env';
import { logger } from './logger';
import { markVideoFailed, processVideoUploaded } from './processors/video-uploaded';

const db = createDb({ poolSize: env.WORKER_CONCURRENCY + 1 });
const s3 = new S3Client({
  region: env.AWS_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

async function s3ObjectExists(key: string): Promise<boolean> {
  if (!env.VIDEOS_BUCKET) throw new Error('VIDEOS_BUCKET is not configured');
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.VIDEOS_BUCKET, Key: key }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'NotFound') return false;
    throw err;
  }
}

const deps = { db, s3ObjectExists, logger };
let consumer: QueueConsumer | undefined;

if (env.VIDEO_EVENTS_QUEUE_URL) {
  consumer = new QueueConsumer({
    sqs: new SQSClient({
      region: env.AWS_REGION,
      ...(env.SQS_ENDPOINT && { endpoint: env.SQS_ENDPOINT }),
    }),
    queueUrl: env.VIDEO_EVENTS_QUEUE_URL,
    concurrency: env.WORKER_CONCURRENCY,
    maxReceiveCount: env.MAX_RECEIVE_COUNT,
    logger,
    handle: async (event) => {
      switch (event.type) {
        case 'video.uploaded':
          return processVideoUploaded(event, deps);
      }
    },
    onFinalFailure: (event) => markVideoFailed(event.videoId, deps),
  });
  consumer.start();
} else {
  logger.warn('VIDEO_EVENTS_QUEUE_URL is not set: worker is idle');
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Worker shutting down');
  const timer = setTimeout(() => process.exit(1), 25_000); // ECS stopTimeout is 30s
  await consumer?.stop();
  await db.$disconnect();
  clearTimeout(timer);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
// Keep the process alive while idle (no consumer).
if (!consumer) setInterval(() => undefined, 60_000);
