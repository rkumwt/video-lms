import type { RequestHandler } from 'express';

import { healthService } from './health.service';

export const healthController = {
  get: ((_req, res) => {
    res.set('Cache-Control', 'no-store').json(healthService.getStatus());
  }) satisfies RequestHandler,

  ready: (async (req, res) => {
    const result = await healthService.getReadiness();
    if (result.status !== 'ok') req.log.error({ result }, 'Readiness check failed');
    res
      .status(result.status === 'ok' ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json(result);
  }) satisfies RequestHandler,
};
