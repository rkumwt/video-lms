import { pino } from 'pino';

import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'api' },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  // Pretty logs locally; structured JSON in containers (CloudWatch parses JSON).
  ...(env.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
});
