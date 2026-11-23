import {
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { type VideoEvent, videoEventSchema } from '@vlp/shared';

import type { Logger } from './logger';

export interface ConsumerOptions {
  sqs: SQSClient;
  queueUrl: string;
  concurrency: number;
  maxReceiveCount: number;
  logger: Logger;
  handle: (event: VideoEvent) => Promise<void>;
  /** Last allowed attempt failed; SQS will move the message to the DLQ next. */
  onFinalFailure: (event: VideoEvent, err: unknown) => Promise<void>;
}

/**
 * Long-polling SQS consumer.
 * - success → DeleteMessage
 * - failure → leave it: it reappears after the visibility timeout; after maxReceiveCount → DLQ
 * - unparseable message → leave it so it ends up in the DLQ for inspection (never "lost")
 */
export class QueueConsumer {
  private running = false;
  private abort = new AbortController();
  private loop: Promise<void> | undefined;

  constructor(private readonly o: ConsumerOptions) {}

  start(): void {
    this.running = true;
    this.loop = this.run();
  }

  /** Stop polling and wait for in-flight messages to finish. */
  async stop(): Promise<void> {
    this.running = false;
    this.abort.abort();
    await this.loop;
  }

  private async run(): Promise<void> {
    const { logger } = this.o;
    logger.info({ queueUrl: this.o.queueUrl }, 'Consumer started');
    let backoffMs = 1000;
    while (this.running) {
      try {
        const { Messages = [] } = await this.o.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.o.queueUrl,
            MaxNumberOfMessages: this.o.concurrency,
            WaitTimeSeconds: 20,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
          { abortSignal: this.abort.signal },
        );
        backoffMs = 1000;
        // Process the batch in parallel; each message is acknowledged on its own.
        await Promise.all(Messages.map((m) => this.processOne(m)));
      } catch (err) {
        if (!this.running) break; // aborted by stop()
        logger.error({ err }, `Receive failed, retrying in ${backoffMs}ms`);
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
    logger.info('Consumer stopped');
  }

  /** Exposed for tests. */
  async processOne(message: Message): Promise<void> {
    const { logger } = this.o;
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
    const log = logger.child({ messageId: message.MessageId, receiveCount });

    let event: VideoEvent;
    try {
      event = videoEventSchema.parse(JSON.parse(message.Body ?? ''));
    } catch (err) {
      log.error(
        { err, body: message.Body?.slice(0, 500) },
        'Invalid message: leaving it for the DLQ',
      );
      return;
    }

    try {
      await this.o.handle(event);
      await this.o.sqs.send(
        new DeleteMessageCommand({
          QueueUrl: this.o.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
    } catch (err) {
      const final = receiveCount >= this.o.maxReceiveCount;
      log.error({ err, type: event.type, final }, 'Processing failed');
      if (final) {
        await this.o
          .onFinalFailure(event, err)
          .catch((e: unknown) => log.error({ err: e }, 'onFinalFailure failed'));
      }
    }
  }
}
