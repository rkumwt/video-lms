import { listVideosQuerySchema } from '@vlp/shared';
import { Router } from 'express';

import { validate } from '../../middlewares/validate';
import { videosController } from './videos.controller';

export const videosRouter = Router();

videosRouter.get('/', validate({ query: listVideosQuerySchema }), videosController.list);
