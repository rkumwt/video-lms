import type { HealthResponse, ReadinessResponse } from '@vlp/shared';

import { env } from '../../config/env';
import { getDb } from '../../lib/db';

export const healthService = {
  /** Liveness: the process is up. Used by the ALB, so a DB outage doesn't kill every task. */
  getStatus(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      version: env.APP_VERSION,
      uptimeSec: Math.round(process.uptime() * 100) / 100,
      timestamp: new Date().toISOString(),
    };
  },

  /** Readiness: dependencies are reachable. */
  async getReadiness(): Promise<ReadinessResponse> {
    try {
      await getDb().$queryRaw`SELECT 1`;
      return { status: 'ok', checks: { database: 'ok' } };
    } catch {
      return { status: 'unavailable', checks: { database: 'error' } };
    }
  },
};
