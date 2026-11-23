import type { ListVideosQuery } from '@vlp/shared';
import type { RequestHandler } from 'express';

import { HttpError } from '../../lib/http-error';
import { videoDetailService, videosService } from './videos.service';

export const videosController = {
  list: (async (_req, res) => {
    const query = res.locals.query as ListVideosQuery;
    res.set('Cache-Control', 'no-store').json(await videosService.list(query));
  }) satisfies RequestHandler,

  get: (async (req, res) => {
    const { id } = req.params as { id: string };
    res.set('Cache-Control', 'no-store').json(await videoDetailService.get(id));
  }) satisfies RequestHandler,

  /** Range requests (seeking) are handled by sendFile. */
  stream: (async (req, res, next) => {
    const { id } = req.params as { id: string };
    const file = await videoDetailService.localFile(id);
    res.type(file.mimeType.split(';')[0]!);
    // The path is server-generated and traversal-checked, so dot-directories are fine.
    res.sendFile(
      file.path,
      { acceptRanges: true, cacheControl: false, dotfiles: 'allow' },
      (err) => {
        if (!err || res.headersSent) return;
        const status = (err as { status?: number }).status;
        next(status === 404 ? HttpError.notFound('Video file not found') : err);
      },
    );
  }) satisfies RequestHandler,
};
