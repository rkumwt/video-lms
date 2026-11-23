import { updateSettingsSchema } from '@vlp/shared';
import { Router } from 'express';

import { validate } from '../../middlewares/validate';
import { settingsController } from './settings.controller';

export const settingsRouter = Router();

settingsRouter.get('/', settingsController.get);
// PATCH semantics on PUT: any subset of fields; strict so typos are rejected, not ignored.
settingsRouter.put(
  '/',
  validate({ body: updateSettingsSchema.strict() }),
  settingsController.update,
);
