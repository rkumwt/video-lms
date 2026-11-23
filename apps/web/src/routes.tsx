import type { RouteObject } from 'react-router';

import { AppLayout } from '@/components/layout/app-layout';
import { HomePage } from '@/pages/home-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { RecordPage } from '@/pages/record-page';
import { SettingsPage } from '@/pages/settings-page';

/** Route table (shared by the browser router and tests). */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'record', element: <RecordPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
