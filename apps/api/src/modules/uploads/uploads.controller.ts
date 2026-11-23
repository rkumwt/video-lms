import type { CompleteUploadInput, CreateUploadInput } from '@vlp/shared';
import type { Request, RequestHandler } from 'express';

import { uploadsService } from './uploads.service';

const idOf = (req: Request) => (req.params as { id: string }).id;

export const uploadsController = {
  create: (async (req, res) => {
    res.status(201).json(await uploadsService.create(req.body as CreateUploadInput));
  }) satisfies RequestHandler,

  receiveFile: (async (req, res) => {
    await uploadsService.receiveFile(idOf(req), req);
    res.status(204).end();
  }) satisfies RequestHandler,

  complete: (async (req, res) => {
    res.json({ video: await uploadsService.complete(idOf(req), req.body as CompleteUploadInput) });
  }) satisfies RequestHandler,

  abort: (async (req, res) => {
    const uploadId = typeof req.query.uploadId === 'string' ? req.query.uploadId : undefined;
    await uploadsService.abort(idOf(req), uploadId);
    res.status(204).end();
  }) satisfies RequestHandler,
};
