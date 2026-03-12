import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  maybeRunTtsCacheMaintenance,
  resetTtsCacheMaintenanceStateForTests,
} from '../src/infrastructure/tts-cache-maintenance.js';

describe('infrastructure/tts-cache-maintenance', () => {
  beforeEach(() => {
    resetTtsCacheMaintenanceStateForTests();
  });

  it('prunes files older than max age', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'tts-cache-age-'));
    const stalePath = path.join(dir, 'stale.mp3');
    const freshPath = path.join(dir, 'fresh.mp3');

    await fs.writeFile(stalePath, Buffer.alloc(64));
    await fs.writeFile(freshPath, Buffer.alloc(64));

    const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await fs.utimes(stalePath, staleDate, staleDate);

    const result = await maybeRunTtsCacheMaintenance({
      cacheDir: dir,
      maxAgeDays: 30,
      maxBytes: 10 * 1024,
      intervalMinutes: 1,
    });

    expect(result.ran).toBe(true);
    expect(result.deletedFiles).toBe(1);
    await expect(fs.access(stalePath)).rejects.toThrow();
    await expect(fs.access(freshPath)).resolves.toBeUndefined();

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('prunes oldest files when cache exceeds max bytes', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'tts-cache-size-'));
    const oldestPath = path.join(dir, 'a-oldest.mp3');
    const middlePath = path.join(dir, 'b-middle.mp3');
    const newestPath = path.join(dir, 'c-newest.mp3');

    await fs.writeFile(oldestPath, Buffer.alloc(8));
    await fs.writeFile(middlePath, Buffer.alloc(8));
    await fs.writeFile(newestPath, Buffer.alloc(8));

    const now = Date.now();
    await fs.utimes(oldestPath, new Date(now - 60_000), new Date(now - 60_000));
    await fs.utimes(middlePath, new Date(now - 30_000), new Date(now - 30_000));
    await fs.utimes(newestPath, new Date(now - 1_000), new Date(now - 1_000));

    const result = await maybeRunTtsCacheMaintenance({
      cacheDir: dir,
      maxAgeDays: 0,
      maxBytes: 16,
      intervalMinutes: 1,
    });

    expect(result.ran).toBe(true);
    expect(result.deletedFiles).toBe(1);
    await expect(fs.access(oldestPath)).rejects.toThrow();
    await expect(fs.access(middlePath)).resolves.toBeUndefined();
    await expect(fs.access(newestPath)).resolves.toBeUndefined();

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('throttles repeated maintenance runs within the configured interval', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'tts-cache-interval-'));
    await fs.writeFile(path.join(dir, 'entry.mp3'), Buffer.alloc(8));

    const options = {
      cacheDir: dir,
      maxAgeDays: 0,
      maxBytes: 1024,
      intervalMinutes: 5,
    };

    const first = await maybeRunTtsCacheMaintenance(options);
    const second = await maybeRunTtsCacheMaintenance(options);

    expect(first.ran).toBe(true);
    expect(second).toMatchObject({
      ran: false,
      reason: 'interval',
    });

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('deduplicates concurrent maintenance calls so only one scan runs', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'tts-cache-inflight-'));
    await fs.writeFile(path.join(dir, 'entry.mp3'), Buffer.alloc(8));

    const readdirSpy = vi.spyOn(fs, 'readdir');
    const options = {
      cacheDir: dir,
      maxAgeDays: 0,
      maxBytes: 1024,
      intervalMinutes: 5,
    };

    const [first, second] = await Promise.all([
      maybeRunTtsCacheMaintenance(options),
      maybeRunTtsCacheMaintenance(options),
    ]);

    expect(first.ran).toBe(true);
    expect(second.ran).toBe(true);
    expect(readdirSpy).toHaveBeenCalledTimes(1);

    readdirSpy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
