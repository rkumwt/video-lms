import type { ListVideosQuery } from '@vlp/shared';
import type { RequestHandler } from 'express';

import { videosService } from './videos.service';

export const videosController = {
  list: (async (_req, res) => {
    const query = res.locals.query as ListVideosQuery;
    res.set('Cache-Control', 'no-store').json(await videosService.list(query));
  }) satisfies RequestHandler,
};
