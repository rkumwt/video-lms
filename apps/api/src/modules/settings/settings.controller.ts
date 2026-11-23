import type { UpdateSettingsInput } from '@vlp/shared';
import type { RequestHandler } from 'express';

import { settingsService } from './settings.service';

export const settingsController = {
  get: (async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await settingsService.get());
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    res.json(await settingsService.update(req.body as UpdateSettingsInput));
  }) satisfies RequestHandler,
};
