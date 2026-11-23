import {
  type SettingsResponse,
  settingsResponseSchema,
  type UpdateSettingsInput,
} from '@vlp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api-client';

import { settingsCache } from './settings-cache';

export const settingsKey = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: async () => {
      const data = await apiFetch('/api/v1/settings', settingsResponseSchema);
      settingsCache.write(data);
      return data;
    },
    // Show cached settings immediately; the request above refreshes them.
    placeholderData: () => settingsCache.read(),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      apiFetch('/api/v1/settings', settingsResponseSchema, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: (data: SettingsResponse) => {
      settingsCache.write(data);
      queryClient.setQueryData(settingsKey, data);
    },
  });
}
