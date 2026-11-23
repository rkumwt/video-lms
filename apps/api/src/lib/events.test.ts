import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { videoEventSchema } from '@vlp/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('VIDEO_EVENTS_QUEUE_URL', 'https://sqs.ap-south-1.amazonaws.com/123/vlp-video-events');

const { events, setSqsClientForTests } = await import('./events');

describe('events.videoUploaded', () => {
  it('sends a versioned, schema-valid message to the queue', async () => {
    const sqsMock = mockClient(SQSClient);
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' });
    setSqsClientForTests(new SQSClient({ region: 'ap-south-1' }));

    await events.videoUploaded('0190a000-0000-7000-8000-000000000001');

    const input = sqsMock.commandCalls(SendMessageCommand)[0]!.args[0].input;
    expect(input.QueueUrl).toContain('vlp-video-events');
    expect(input.MessageAttributes?.type?.StringValue).toBe('video.uploaded');
    expect(videoEventSchema.parse(JSON.parse(input.MessageBody!))).toMatchObject({
      type: 'video.uploaded',
      version: 1,
      videoId: '0190a000-0000-7000-8000-000000000001',
    });
  });
});
