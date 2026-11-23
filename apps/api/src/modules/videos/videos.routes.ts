import { listVideosQuerySchema, videoIdParamsSchema } from '@vlp/shared';
import { Router } from 'express';

import { validate } from '../../middlewares/validate';
import { videosController } from './videos.controller';

export const videosRouter = Router();

videosRouter.get('/', validate({ query: listVideosQuerySchema }), videosController.list);
videosRouter.get('/:id', validate({ params: videoIdParamsSchema }), videosController.get);
videosRouter.get('/:id/stream', validate({ params: videoIdParamsSchema }), videosController.stream);
