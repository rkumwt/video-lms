import type { RequestHandler } from 'express';

import { healthService } from './health.service';

export const healthController = {
  get: ((_req, res) => {
    res.set('Cache-Control', 'no-store').json(healthService.getStatus());
  }) satisfies RequestHandler,
};
