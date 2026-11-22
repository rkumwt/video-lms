import type { ApiError } from '@vlp/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import { HttpError } from '../lib/http-error';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
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
