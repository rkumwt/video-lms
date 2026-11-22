import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { UploadInstructions } from '@vlp/shared';

import {
  type CompleteUploadParams,
  type StartUploadParams,
  type StorageDriver,
  StorageError,
} from './types';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  urlTtlSec: number;
  multipartThresholdBytes: number;
  partSizeBytes: number;
}

/** S3 allows at most 10,000 parts; grow the part size for very large files. */
const MAX_PARTS = 10_000;

export function createS3Client(
  o: Pick<S3StorageOptions, 'region' | 'endpoint' | 'forcePathStyle'>,
) {
  return new S3Client({
    region: o.region,
    ...(o.endpoint && { endpoint: o.endpoint }),
    forcePathStyle: o.forcePathStyle ?? false,
    // SDK v3 adds CRC32 checksum params to presigned URLs by default, which browsers can't satisfy.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * Browsers upload straight to S3 with presigned URLs, so video bytes never pass through the API
 * (no Fargate bandwidth, memory or timeouts). Credentials come from the ECS task role.
 */
export class S3Storage implements StorageDriver {
  readonly type = 'S3' as const;

  constructor(
    private readonly o: S3StorageOptions,
    private readonly client: S3Client = createS3Client(o),
  ) {}

  async startUpload({
    key,
    contentType,
    sizeBytes,
  }: StartUploadParams): Promise<UploadInstructions> {
    const expiresIn = this.o.urlTtlSec;

    if (sizeBytes <= this.o.multipartThresholdBytes) {
      const url = await getSignedUrl(
        this.client,
        // ContentLength is signed, so S3 rejects a body of any other size.
        new PutObjectCommand({
          Bucket: this.o.bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        { expiresIn },
      );
      return { strategy: 's3-single', url, headers: { 'Content-Type': contentType } };
    }

    const partSizeBytes = Math.max(this.o.partSizeBytes, Math.ceil(sizeBytes / MAX_PARTS));
    const partCount = Math.ceil(sizeBytes / partSizeBytes);

    const { UploadId } = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.o.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!UploadId) throw new Error('S3 did not return an UploadId');

    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, i) => ({
        partNumber: i + 1,
        url: await getSignedUrl(
          this.client,
          new UploadPartCommand({
            Bucket: this.o.bucket,
            Key: key,
            UploadId,
            PartNumber: i + 1,
          }),
          { expiresIn },
        ),
      })),
    );
    return { strategy: 's3-multipart', uploadId: UploadId, partSizeBytes, parts };
  }

  async completeUpload({
    key,
    expectedSizeBytes,
    uploadId,
    parts,
  }: CompleteUploadParams): Promise<{ sizeBytes: number }> {
    if (uploadId) {
      if (!parts?.length) throw new StorageError('parts are required for multipart', 'INCOMPLETE');
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.o.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    }

    // Verify the object really exists (the browser could call /complete without uploading).
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.o.bucket, Key: key }),
      );
      const sizeBytes = head.ContentLength ?? 0;
      if (sizeBytes !== expectedSizeBytes) {
        throw new StorageError(
          `Uploaded size ${sizeBytes} does not match declared size ${expectedSizeBytes}`,
          'INCOMPLETE',
        );
      }
      return { sizeBytes };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      if ((err as { name?: string }).name === 'NotFound') {
        throw new StorageError('The file has not been uploaded yet', 'INCOMPLETE');
      }
      throw err;
    }
  }

  async abortUpload(key: string, uploadId?: string): Promise<void> {
    if (uploadId) {
      await this.client.send(
        new AbortMultipartUploadCommand({ Bucket: this.o.bucket, Key: key, UploadId: uploadId }),
      );
    }
    await this.deleteObject(key);
  }

  getPlaybackUrl(key: string, _videoId: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.o.bucket, Key: key, ResponseContentType: contentType }),
      { expiresIn: this.o.urlTtlSec },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.o.bucket, Key: key }));
  }
}
