import type { RequestHandler } from 'express';
import { z } from 'zod';

import { HttpError } from '../lib/http-error';

type Schemas = {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};

/**
 * Validates request parts with Zod. Parsed (and coerced) values replace the raw ones,
 * so controllers can trust `req.body` etc. Express 5 makes `req.query` a getter,
 * so validated query is stored on `res.locals.query`.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, res, next) => {
    const issues: Record<string, unknown> = {};

    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        issues[key] = z.flattenError(result.error);
        continue;
      }
      if (key === 'query') res.locals.query = result.data;
      else req[key] = result.data;
    }

    if (Object.keys(issues).length > 0) {
      next(HttpError.badRequest('Validation failed', issues));
      return;
    }
    next();
  };
