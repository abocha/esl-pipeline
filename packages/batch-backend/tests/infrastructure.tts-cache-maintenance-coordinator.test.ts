import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWithPgClient = vi.fn();
const mockMaybeRunTtsCacheMaintenance = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('../src/infrastructure/db.js', () => ({
  withPgClient: mockWithPgClient,
}));

vi.mock('../src/infrastructure/tts-cache-maintenance.js', () => ({
  maybeRunTtsCacheMaintenance: mockMaybeRunTtsCacheMaintenance,
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

describe('infrastructure/tts-cache-maintenance-coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits before lock acquisition when maintenance is disabled', async () => {
    const { maybeRunTtsCacheMaintenanceWithPgLock } = await import(
      '../src/infrastructure/tts-cache-maintenance-coordinator.js'
    );

    const result = await maybeRunTtsCacheMaintenanceWithPgLock({
      cacheDir: '/tmp/tts-cache',
      maxAgeDays: 30,
      maxBytes: 1024,
      intervalMinutes: 0,
      lockKey: '910021',
    });

    expect(result).toEqual({
      ran: false,
      reason: 'disabled',
      scannedFiles: 0,
      deletedFiles: 0,
      reclaimedBytes: 0,
      remainingBytes: 0,
    });
    expect(mockWithPgClient).not.toHaveBeenCalled();
    expect(mockMaybeRunTtsCacheMaintenance).not.toHaveBeenCalled();
  });

  it('runs maintenance when advisory lock is acquired and releases lock after', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });

    mockWithPgClient.mockImplementationOnce(async (fn: (client: { query: typeof query }) => unknown) =>
      fn({ query }),
    );
    mockMaybeRunTtsCacheMaintenance.mockResolvedValueOnce({
      ran: true,
      scannedFiles: 1,
      deletedFiles: 0,
      reclaimedBytes: 0,
      remainingBytes: 128,
    });

    const { maybeRunTtsCacheMaintenanceWithPgLock } = await import(
      '../src/infrastructure/tts-cache-maintenance-coordinator.js'
    );

    const result = await maybeRunTtsCacheMaintenanceWithPgLock({
      cacheDir: '/tmp/tts-cache',
      maxAgeDays: 30,
      maxBytes: 1024,
      intervalMinutes: 60,
      lockKey: '910021',
    });

    expect(result).toMatchObject({ ran: true });
    expect(mockMaybeRunTtsCacheMaintenance).toHaveBeenCalledWith({
      cacheDir: '/tmp/tts-cache',
      maxAgeDays: 30,
      maxBytes: 1024,
      intervalMinutes: 60,
    });
    expect(query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      ['910021'],
    );
    expect(query).toHaveBeenNthCalledWith(2, 'SELECT pg_advisory_unlock($1::bigint)', ['910021']);
  });

  it('skips maintenance when advisory lock is already held by another worker', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ acquired: false }] });

    mockWithPgClient.mockImplementationOnce(async (fn: (client: { query: typeof query }) => unknown) =>
      fn({ query }),
    );

    const { maybeRunTtsCacheMaintenanceWithPgLock } = await import(
      '../src/infrastructure/tts-cache-maintenance-coordinator.js'
    );

    const result = await maybeRunTtsCacheMaintenanceWithPgLock({
      cacheDir: '/tmp/tts-cache',
      maxAgeDays: 30,
      maxBytes: 1024,
      intervalMinutes: 60,
      lockKey: '910021',
    });

    expect(result).toEqual({
      ran: false,
      reason: 'global_lock',
      scannedFiles: 0,
      deletedFiles: 0,
      reclaimedBytes: 0,
      remainingBytes: 0,
    });
    expect(mockMaybeRunTtsCacheMaintenance).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('propagates maintenance failures while still releasing advisory lock', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });

    mockWithPgClient.mockImplementationOnce(async (fn: (client: { query: typeof query }) => unknown) =>
      fn({ query }),
    );
    mockMaybeRunTtsCacheMaintenance.mockRejectedValueOnce(new Error('maintenance failed'));

    const { maybeRunTtsCacheMaintenanceWithPgLock } = await import(
      '../src/infrastructure/tts-cache-maintenance-coordinator.js'
    );

    await expect(
      maybeRunTtsCacheMaintenanceWithPgLock({
        cacheDir: '/tmp/tts-cache',
        maxAgeDays: 30,
        maxBytes: 1024,
        intervalMinutes: 60,
        lockKey: '910021',
      }),
    ).rejects.toThrow('maintenance failed');

    expect(query).toHaveBeenNthCalledWith(2, 'SELECT pg_advisory_unlock($1::bigint)', ['910021']);
  });

  it('logs warning when unlock fails but returns maintenance result', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockRejectedValueOnce(new Error('unlock failed'));

    mockWithPgClient.mockImplementationOnce(async (fn: (client: { query: typeof query }) => unknown) =>
      fn({ query }),
    );
    mockMaybeRunTtsCacheMaintenance.mockResolvedValueOnce({
      ran: true,
      scannedFiles: 2,
      deletedFiles: 1,
      reclaimedBytes: 256,
      remainingBytes: 512,
    });

    const { maybeRunTtsCacheMaintenanceWithPgLock } = await import(
      '../src/infrastructure/tts-cache-maintenance-coordinator.js'
    );

    const result = await maybeRunTtsCacheMaintenanceWithPgLock({
      cacheDir: '/tmp/tts-cache',
      maxAgeDays: 30,
      maxBytes: 1024,
      intervalMinutes: 60,
      lockKey: '910021',
    });

    expect(result).toMatchObject({ ran: true, deletedFiles: 1 });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to release TTS cache maintenance advisory lock',
      expect.objectContaining({
        component: 'tts-cache-maintenance',
        lockKey: '910021',
        error: 'unlock failed',
      }),
    );
  });
});
