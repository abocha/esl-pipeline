import { describe, expect, it, vi } from 'vitest';

import { resolveLoggerTransport } from '../src/infrastructure/logger.js';

describe('resolveLoggerTransport', () => {
  it('returns pino-pretty transport in development when module is resolvable', () => {
    const resolveModule = vi.fn(() => '/tmp/pino-pretty');
    const warn = vi.fn();

    const transport = resolveLoggerTransport({
      nodeEnv: 'development',
      resolveModule,
      warn,
    });

    expect(resolveModule).toHaveBeenCalledWith('pino-pretty');
    expect(transport).toMatchObject({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to JSON transport when pino-pretty cannot be resolved', () => {
    const resolveModule = vi.fn(() => {
      throw new Error('module missing');
    });
    const warn = vi.fn();

    const transport = resolveLoggerTransport({
      nodeEnv: 'development',
      resolveModule,
      warn,
    });

    expect(resolveModule).toHaveBeenCalledWith('pino-pretty');
    expect(transport).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('pino-pretty is unavailable; falling back to JSON logs.');
  });

  it('skips pretty transport outside development', () => {
    const resolveModule = vi.fn(() => '/tmp/pino-pretty');
    const warn = vi.fn();

    const transport = resolveLoggerTransport({
      nodeEnv: 'production',
      resolveModule,
      warn,
    });

    expect(transport).toBeUndefined();
    expect(resolveModule).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
