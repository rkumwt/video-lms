import type { ApiError } from '@vlp/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import { HttpError } from '../lib/http-error';
import { StorageError } from '../lib/storage/types';

/** Domain errors → HTTP. Anything else is a 500 with a generic message. */
function toHttpError(err: unknown): unknown {
  if (err instanceof StorageError) {
    const map = {
      NOT_CONFIGURED: [503, 'STORAGE_NOT_CONFIGURED'],
      DISABLED: [400, 'STORAGE_DISABLED'],
      INCOMPLETE: [409, 'UPLOAD_INCOMPLETE'],
      TOO_LARGE: [413, 'PAYLOAD_TOO_LARGE'],
      NOT_FOUND: [404, 'NOT_FOUND'],
    } as const;
    const [status, code] = map[err.code];
    return new HttpError(status, code, err.message);
  }
  return err;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (rawErr: unknown, req, res, _next) => {
  const err = toHttpError(rawErr);
  const isHttp = err instanceof HttpError;
  const status = isHttp ? err.status : 500;

  if (status >= 500) req.log.error({ err }, 'Unhandled error');
  else req.log.warn({ err }, 'Request failed');

  const body: ApiError = {
    error: {
      code: isHttp ? err.code : 'INTERNAL_SERVER_ERROR',
      // Never leak internal error messages to clients.
      message: isHttp ? err.message : 'Something went wrong',
      ...(isHttp && err.details !== undefined && { details: err.details }),
      ...(typeof req.id !== 'object' && { requestId: String(req.id) }),
    },
  };
  res.status(status).json(body);
};
