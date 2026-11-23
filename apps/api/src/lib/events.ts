import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { VideoEvent } from '@vlp/shared';

import { env } from '../config/env';
import { logger } from './logger';

let client: SQSClient | undefined;
function sqs(): SQSClient {
  client ??= new SQSClient({
    region: env.AWS_REGION,
    ...(env.SQS_ENDPOINT && { endpoint: env.SQS_ENDPOINT }),
  });
  return client;
}

async function publish(event: VideoEvent): Promise<void> {
  if (!env.VIDEO_EVENTS_QUEUE_URL) {
    logger.warn({ event }, 'VIDEO_EVENTS_QUEUE_URL not set: event not queued');
    return;
  }
  // The SDK retries transient failures (3 attempts with backoff) before throwing.
  const { MessageId } = await sqs().send(
    new SendMessageCommand({
      QueueUrl: env.VIDEO_EVENTS_QUEUE_URL,
      MessageBody: JSON.stringify(event),
      MessageAttributes: { type: { DataType: 'String', StringValue: event.type } },
    }),
  );
  logger.info({ messageId: MessageId, type: event.type, videoId: event.videoId }, 'Event queued');
}

/** Domain events for background processing (consumed by apps/worker). */
export const events = {
  videoUploaded(videoId: string): Promise<void> {
    return publish({
      type: 'video.uploaded',
      version: 1,
      videoId,
      occurredAt: new Date().toISOString(),
    });
  },
};

/** Test hook. */
export function setSqsClientForTests(c: SQSClient): void {
  client = c;
}
