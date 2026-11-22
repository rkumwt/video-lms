import {
  recordingQualitySchema,
  recordingTypeSchema,
  storageTypeSchema,
  videoStatusSchema,
} from '@vlp/shared';
import { describe, expect, it } from 'vitest';

import {
  RecordingQuality,
  RecordingType,
  StorageType,
  VideoStatus,
} from './generated/prisma/enums';

// The browser uses @vlp/shared; the server uses Prisma. Fail CI if they drift apart.
describe('shared Zod enums match Prisma enums', () => {
  it.each([
    ['RecordingType', recordingTypeSchema.options, RecordingType],
    ['StorageType', storageTypeSchema.options, StorageType],
    ['VideoStatus', videoStatusSchema.options, VideoStatus],
    ['RecordingQuality', recordingQualitySchema.options, RecordingQuality],
  ])('%s', (_name, zodValues, prismaEnum) => {
    expect([...zodValues].sort()).toEqual(Object.values(prismaEnum).sort());
  });
});
