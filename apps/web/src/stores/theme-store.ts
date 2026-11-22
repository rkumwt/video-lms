import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const THEME_STORAGE_KEY = 'vlp-theme';

/** UI preference only (per browser). Server data lives in TanStack Query, not here. */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: THEME_STORAGE_KEY, storage: createJSONStorage(() => localStorage) },
  ),
);

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applies the theme to <html> and follows OS changes while on "system". Returns a cleanup fn. */
export function applyTheme(theme: Theme): () => void {
  const root = document.documentElement;
  const update = () => root.classList.toggle('dark', resolveTheme(theme) === 'dark');
  update();
  if (theme !== 'system') return () => undefined;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
