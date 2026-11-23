import { completeUploadSchema, createUploadSchema, videoIdParamsSchema } from '@vlp/shared';
import { Router } from 'express';

import { validate } from '../../middlewares/validate';
import { uploadsController } from './uploads.controller';

export const uploadsRouter = Router();

uploadsRouter.post('/', validate({ body: createUploadSchema }), uploadsController.create);
// Raw body (no JSON parsing): streamed straight to disk. LOCAL storage only.
uploadsRouter.put(
  '/:id/file',
  validate({ params: videoIdParamsSchema }),
  uploadsController.receiveFile,
);
uploadsRouter.post(
  '/:id/complete',
  validate({ params: videoIdParamsSchema, body: completeUploadSchema }),
  uploadsController.complete,
);
uploadsRouter.delete('/:id', validate({ params: videoIdParamsSchema }), uploadsController.abort);
