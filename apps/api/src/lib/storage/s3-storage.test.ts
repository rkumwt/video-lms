import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';

import { createS3Client, S3Storage } from './s3-storage';
import { StorageError } from './types';

const MiB = 1024 * 1024;
const s3Mock = mockClient(S3Client);

function makeStorage() {
  const opts = {
    bucket: 'videos',
    region: 'ap-south-1',
    urlTtlSec: 900,
    multipartThresholdBytes: 64 * MiB,
    partSizeBytes: 16 * MiB,
  };
  const client = createS3Client(opts);
  client.config.credentials = () =>
    Promise.resolve({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' });
  return new S3Storage(opts, client);
}

beforeEach(() => s3Mock.reset());

describe('S3Storage.startUpload', () => {
  it('presigns a single PUT with the size signed and no checksum params', async () => {
    const result = await makeStorage().startUpload({
      videoId: 'v',
      key: 'videos/v/original.webm',
      contentType: 'video/webm',
      sizeBytes: 10 * MiB,
    });
    expect(result.strategy).toBe('s3-single');
    if (result.strategy !== 's3-single') return;
    const url = new URL(result.url);
    expect(url.pathname).toContain('videos/v/original.webm');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    // Browsers can't send these; presence would break direct uploads.
    expect(url.search).not.toMatch(/x-amz-checksum|x-amz-sdk-checksum-algorithm/i);
  });

  it('uses multipart above the threshold with one presigned URL per part', async () => {
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: 'up-1' });
    const result = await makeStorage().startUpload({
      videoId: 'v',
      key: 'k',
      contentType: 'video/webm',
      sizeBytes: 100 * MiB,
    });
    expect(result.strategy).toBe('s3-multipart');
    if (result.strategy !== 's3-multipart') return;
    expect(result.uploadId).toBe('up-1');
    expect(result.partSizeBytes).toBe(16 * MiB);
    expect(result.parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new URL(result.parts[0]!.url).searchParams.get('uploadId')).toBe('up-1');
  });
});

describe('S3Storage.completeUpload', () => {
  it('completes multipart with parts in order, then verifies the size', async () => {
    s3Mock.on(CompleteMultipartUploadCommand).resolves({});
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 42 });

    const res = await makeStorage().completeUpload({
      key: 'k',
      expectedSizeBytes: 42,
      uploadId: 'up-1',
      parts: [
        { partNumber: 2, etag: '"b"' },
        { partNumber: 1, etag: '"a"' },
      ],
    });

    expect(res.sizeBytes).toBe(42);
    const call = s3Mock.commandCalls(CompleteMultipartUploadCommand)[0]!;
    expect(call.args[0].input.MultipartUpload?.Parts).toEqual([
      { PartNumber: 1, ETag: '"a"' },
      { PartNumber: 2, ETag: '"b"' },
    ]);
  });

  it('rejects when the object is missing or the size differs', async () => {
    const storage = makeStorage();
    s3Mock.on(HeadObjectCommand).rejectsOnce(Object.assign(new Error('nf'), { name: 'NotFound' }));
    await expect(storage.completeUpload({ key: 'k', expectedSizeBytes: 1 })).rejects.toBeInstanceOf(
      StorageError,
    );
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 5 });
    await expect(storage.completeUpload({ key: 'k', expectedSizeBytes: 9 })).rejects.toThrow(
      /does not match/,
    );
  });
});
