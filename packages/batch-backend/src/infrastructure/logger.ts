// packages/batch-backend/src/infrastructure/logger.ts
// Pino-based JSON logger with a minimal typed wrapper.
// - Container-friendly (stdout JSON).
// - Pretty printing in development only.
// - Supports child loggers with jobId/runId bindings.
import { createRequire } from 'node:module';

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

export interface ResolveLoggerTransportOptions {
  nodeEnv?: string;
  resolveModule?: (specifier: string) => string;
  warn?: (message: string) => void;
}

const require = createRequire(import.meta.url);

// logger.declaration()
export const logger: Logger = createRootLogger();

function resolveLogLevel(): string {
  if (process.env.NODE_ENV === 'test') {
    return process.env.BATCH_BACKEND_TEST_LOG_LEVEL || process.env.LOG_LEVEL || 'silent';
  }
  return process.env.LOG_LEVEL || 'info';
}

export function resolveLoggerTransport(
  options: ResolveLoggerTransportOptions = {},
): pino.LoggerOptions['transport'] {
  const {
    nodeEnv = process.env.NODE_ENV,
    resolveModule = (specifier: string) => require.resolve(specifier),
    warn = (message: string) => console.warn(message),
  } = options;

  if (nodeEnv !== 'development') {
    return undefined;
  }

  try {
    resolveModule('pino-pretty');
  } catch {
    warn('pino-pretty is unavailable; falling back to JSON logs.');
    return undefined;
  }

  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  };
}

function createRootLogger(): Logger {
  const base = pino({
    level: resolveLogLevel(),
    transport: resolveLoggerTransport(),
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
            ...fields,
            err: {
              message: msg.message,
              stack: msg.stack,
              name: msg.name,
            },
          },
          msg.message,
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
