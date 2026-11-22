import type { HealthResponse } from '@vlp/shared';

import { env } from '../../config/env';

export const healthService = {
  getStatus(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      version: env.APP_VERSION,
      uptimeSec: Math.round(process.uptime() * 100) / 100,
      timestamp: new Date().toISOString(),
    };
  },
};
