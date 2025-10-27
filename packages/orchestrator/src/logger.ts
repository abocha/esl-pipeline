type LogLevel = 'info' | 'warn' | 'error' | 'step' | 'success';

export type LogEvent = {
  level: LogLevel;
  message: string;
  details?: Record<string, unknown> | undefined;
  timestamp: string;
};

export type Logger = {
  info: (message: string, details?: Record<string, unknown>) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
  error: (message: string, details?: Record<string, unknown>) => void;
  step: (message: string, details?: Record<string, unknown>) => void;
  success: (message: string, details?: Record<string, unknown>) => void;
  events: () => LogEvent[];
  flush: (final?: Record<string, unknown>) => void;
};

type LoggerOptions = {
  json?: boolean;
};

function formatMessage(level: LogLevel, message: string): string {
  const icon =
    level === 'info'
      ? 'ℹ️'
      : level === 'warn'
        ? '⚠️'
        : level === 'error'
          ? '❌'
          : level === 'success'
            ? '✅'
            : '•';
  return `${icon} ${message}`;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const { json = false } = options;
  const events: LogEvent[] = [];

  const push = (level: LogLevel, message: string, details?: Record<string, unknown>) => {
    const event: LogEvent = {
      level,
      message,
      details,
      timestamp: new Date().toISOString(),
    };
    events.push(event);
    if (!json) {
      if (details && Object.keys(details).length > 0) {
        console.log(formatMessage(level, message), details);
      } else {
        console.log(formatMessage(level, message));
      }
    }
  };

  return {
    info: (message, details) => push('info', message, details),
    warn: (message, details) => push('warn', message, details),
    error: (message, details) => push('error', message, details),
    step: (message, details) => push('step', message, details),
    success: (message, details) => push('success', message, details),
    events: () => events,
    flush: final => {
      if (json) {
        const payload = { events, result: final ?? null };
        console.log(JSON.stringify(payload, null, 2));
      }
    },
  };
}
