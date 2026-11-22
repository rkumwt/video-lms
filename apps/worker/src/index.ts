import { pino } from 'pino';

import { env } from './env';

const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  ...(env.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
});

// Phase 9 replaces this heartbeat with an SQS long-polling consumer.
logger.info('Worker started');
const timer = setInterval(() => logger.debug('Worker heartbeat'), env.HEARTBEAT_INTERVAL_MS);

function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down');
  clearInterval(timer);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
