import type { RouteObject } from 'react-router';

import { AppLayout } from '@/components/layout/app-layout';
import { HomePage } from '@/pages/home-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { PlaceholderPage } from '@/pages/placeholder-page';

/** Route table (shared by the browser router and tests). */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'record', element: <PlaceholderPage title="Record" phase={8} /> },
      { path: 'settings', element: <PlaceholderPage title="Settings" phase={8} /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
