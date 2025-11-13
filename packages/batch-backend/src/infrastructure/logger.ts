// packages/batch-backend/src/infrastructure/logger.ts

// Pino-based JSON logger with a minimal typed wrapper.
// - Container-friendly (stdout JSON).
// - Pretty printing in development only.
// - Supports child loggers with jobId/runId bindings.

import pino from 'pino';

export interface LogFields {
  jobId?: string;
  runId?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string | Error, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

// logger.declaration()
export const logger: Logger = createRootLogger();

function createRootLogger(): Logger {
  const base = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
            },
          }
        : undefined,
  });

  const wrap = (instance: pino.Logger): Logger => ({
    info(msg, fields) {
      instance.info(fields ?? {}, msg);
    },
    warn(msg, fields) {
      instance.warn(fields ?? {}, msg);
    },
    error(msg, fields) {
      if (msg instanceof Error) {
        instance.error(
          {
            ...(fields ?? {}),
            err: {
              message: msg.message,
              stack: msg.stack,
              name: msg.name,
            },
          },
          msg.message
        );
      } else {
        instance.error(fields ?? {}, msg);
      }
    },
    debug(msg, fields) {
      instance.debug(fields ?? {}, msg);
    },
    child(bindings) {
      return wrap(instance.child(bindings));
    },
  });

  return wrap(base);
}

export function createJobLogger(jobId: string, runId?: string): Logger {
  return logger.child({ jobId, runId });
}
