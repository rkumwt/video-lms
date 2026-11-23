import type { Setting } from '@vlp/db';
import type { SettingsResponse, StorageType, UpdateSettingsInput } from '@vlp/shared';

import { env } from '../../config/env';
import { getDb } from '../../lib/db';
import { HttpError } from '../../lib/http-error';

/** Which storage targets this deployment can serve. */
export function availableStorage(): StorageType[] {
  const targets: StorageType[] = [];
  if (env.VIDEOS_BUCKET) targets.push('S3');
  if (env.STORAGE_LOCAL_ENABLED) targets.push('LOCAL');
  return targets;
}

function toResponse(row: Setting): SettingsResponse {
  const available = availableStorage();
  return {
    settings: {
      // If the saved target isn't usable here (e.g. LOCAL on AWS), report what will actually be used.
      storageTarget: available.includes(row.storageTarget) ? row.storageTarget : available[0]!,
      defaultRecordingMode: row.defaultRecordingMode,
      quality: row.quality,
      micEnabled: row.micEnabled,
      updatedAt: row.updatedAt.toISOString(),
    },
    availableStorage: available,
  };
}

export const settingsService = {
  async get(): Promise<SettingsResponse> {
    // Upsert keeps the singleton invariant even if the seed row was deleted.
    const row = await getDb().setting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    return toResponse(row);
  },

  async update(input: UpdateSettingsInput): Promise<SettingsResponse> {
    if (input.storageTarget && !availableStorage().includes(input.storageTarget)) {
      throw HttpError.badRequest(
        `Storage target ${input.storageTarget} is not available on this server`,
      );
    }
    const row = await getDb().setting.upsert({
      where: { id: 1 },
      create: { id: 1, ...input },
      update: input,
    });
    return toResponse(row);
  },
};
