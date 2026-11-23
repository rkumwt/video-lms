import { type SettingsResponse, settingsResponseSchema } from '@vlp/shared';

const KEY = 'vlp-settings';

/**
 * Last known settings, so the Record page can start with the right defaults instantly (even offline)
 * while the API refreshes them. The database stays the source of truth.
 */
export const settingsCache = {
  read(): SettingsResponse | undefined {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return undefined;
      const parsed = settingsResponseSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined; // ignore stale/corrupt shapes
    } catch {
      return undefined;
    }
  },
  write(value: SettingsResponse): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Storage full or blocked (private mode): the cache is optional.
    }
  },
};
