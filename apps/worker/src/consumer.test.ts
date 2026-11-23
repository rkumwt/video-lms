import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QueueConsumer } from './consumer';

const sqsMock = mockClient(SQSClient);
const body = JSON.stringify({
  type: 'video.uploaded',
  version: 1,
  videoId: '0190a000-0000-7000-8000-000000000001',
  occurredAt: new Date().toISOString(),
});
const msg = (receiveCount: number, b = body) => ({
  MessageId: 'm',
  ReceiptHandle: 'rh',
  Body: b,
  Attributes: { ApproximateReceiveCount: String(receiveCount) },
});

function makeConsumer(handle: () => Promise<void>) {
  const onFinalFailure = vi.fn(() => Promise.resolve());
  const consumer = new QueueConsumer({
    sqs: new SQSClient({ region: 'ap-south-1' }),
    queueUrl: 'https://sqs/q',
    concurrency: 2,
    maxReceiveCount: 5,
    logger: pino({ level: 'silent' }),
    handle: vi.fn(handle),
    onFinalFailure,
  });
  return { consumer, onFinalFailure };
}

beforeEach(() => sqsMock.reset());

describe('QueueConsumer.processOne', () => {
  it('deletes the message after successful processing', async () => {
    const { consumer } = makeConsumer(() => Promise.resolve());
    await consumer.processOne(msg(1));
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1);
  });

  it('leaves failed messages on the queue for retry', async () => {
    const { consumer, onFinalFailure } = makeConsumer(() => Promise.reject(new Error('boom')));
    await consumer.processOne(msg(2));
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
    expect(onFinalFailure).not.toHaveBeenCalled();
  });

  it('runs onFinalFailure on the last allowed attempt (before the DLQ)', async () => {
    const { consumer, onFinalFailure } = makeConsumer(() => Promise.reject(new Error('boom')));
    await consumer.processOne(msg(5));
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
  });

  it('never processes or deletes malformed messages (they end up in the DLQ)', async () => {
    const handle = vi.fn(() => Promise.resolve());
    const { consumer } = makeConsumer(handle);
    await consumer.processOne(msg(1, '{"type":"nope"}'));
    await consumer.processOne(msg(1, 'not json'));
    expect(handle).not.toHaveBeenCalled();
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
  });
});

describe('QueueConsumer lifecycle', () => {
  it('long-polls with receive counts and stops cleanly', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });
    const { consumer } = makeConsumer(() => Promise.resolve());
    consumer.start();
    await vi.waitFor(() =>
      expect(sqsMock.commandCalls(ReceiveMessageCommand).length).toBeGreaterThan(0),
    );
    await consumer.stop();
    const input = sqsMock.commandCalls(ReceiveMessageCommand)[0]!.args[0].input;
    expect(input).toMatchObject({ WaitTimeSeconds: 20, MaxNumberOfMessages: 2 });
    expect(input.MessageSystemAttributeNames).toContain('ApproximateReceiveCount');
  });
});
