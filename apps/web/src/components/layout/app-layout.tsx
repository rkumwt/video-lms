import { healthResponseSchema } from '@vlp/shared';
import { useQuery } from '@tanstack/react-query';
import { Clapperboard, House, Settings, Video } from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink, Outlet } from 'react-router';

import { Toaster } from '@/components/ui/sonner';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { applyTheme, useThemeStore } from '@/stores/theme-store';

import { ThemeToggle } from './theme-toggle';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/record', label: 'Record', icon: Video, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

export function AppLayout() {
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Clapperboard className="text-primary size-5" aria-hidden />
            <span className="hidden sm:inline">Learning Video Platform</span>
          </Link>

          <nav aria-label="Main" className="ml-auto flex items-center gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{label}</span>
              </NavLink>
            ))}
          </nav>

          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <AppFooter />
      <Toaster richColors position="bottom-right" />
    </div>
  );
}

function AppFooter() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health', healthResponseSchema),
    staleTime: 5 * 60_000,
  });

  return (
    <footer className="text-muted-foreground border-t py-4 text-center text-xs">
      {health.isSuccess ? `API v${health.data.version}` : health.isError ? 'API unreachable' : ''}
    </footer>
  );
}
