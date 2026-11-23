import { describe, expect, it } from 'vitest';

import { createUploadSchema, MAX_UPLOAD_BYTES, uploadInstructionsSchema } from './upload';

const valid = {
  title: '  Demo  ',
  recordingType: 'SCREEN_CAMERA',
  mimeType: 'video/webm;codecs=vp9,opus',
  sizeBytes: 1024,
  durationSec: 12,
};

describe('createUploadSchema', () => {
  it('accepts MediaRecorder mime types and trims the title', () => {
    expect(createUploadSchema.parse(valid).title).toBe('Demo');
  });

  it('rejects non-video files, empty titles and oversized uploads', () => {
    expect(createUploadSchema.safeParse({ ...valid, mimeType: 'image/png' }).success).toBe(false);
    expect(createUploadSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
    expect(
      createUploadSchema.safeParse({ ...valid, sizeBytes: MAX_UPLOAD_BYTES + 1 }).success,
    ).toBe(false);
  });
});

describe('uploadInstructionsSchema', () => {
  it('discriminates on strategy', () => {
    const parsed = uploadInstructionsSchema.parse({
      strategy: 'local',
      url: '/api/v1/uploads/x/file',
      headers: { 'Content-Type': 'video/webm' },
    });
    expect(parsed.strategy).toBe('local');
    expect(
      uploadInstructionsSchema.safeParse({ strategy: 's3-multipart', parts: [] }).success,
    ).toBe(false);
  });
});
