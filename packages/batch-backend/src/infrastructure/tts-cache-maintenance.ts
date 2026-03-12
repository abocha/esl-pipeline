import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

interface TtsCacheFileEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface TtsCacheMaintenanceOptions {
  cacheDir: string;
  maxAgeDays: number;
  maxBytes: number;
  intervalMinutes: number;
}

export interface TtsCacheMaintenanceResult {
  ran: boolean;
  reason?: 'interval' | 'disabled' | 'global_lock';
  scannedFiles: number;
  deletedFiles: number;
  reclaimedBytes: number;
  remainingBytes: number;
}

let lastMaintenanceAtMs = 0;
let inFlightMaintenance: Promise<TtsCacheMaintenanceResult> | null = null;

export function resetTtsCacheMaintenanceStateForTests(): void {
  lastMaintenanceAtMs = 0;
  inFlightMaintenance = null;
}

export async function maybeRunTtsCacheMaintenance(
  options: TtsCacheMaintenanceOptions,
): Promise<TtsCacheMaintenanceResult> {
  const intervalMs = Math.max(0, options.intervalMinutes) * 60_000;
  const now = Date.now();

  if (intervalMs === 0) {
    return {
      ran: false,
      reason: 'disabled',
      scannedFiles: 0,
      deletedFiles: 0,
      reclaimedBytes: 0,
      remainingBytes: 0,
    };
  }

  if (inFlightMaintenance) {
    return inFlightMaintenance;
  }

  if (lastMaintenanceAtMs > 0 && now - lastMaintenanceAtMs < intervalMs) {
    return {
      ran: false,
      reason: 'interval',
      scannedFiles: 0,
      deletedFiles: 0,
      reclaimedBytes: 0,
      remainingBytes: 0,
    };
  }

  lastMaintenanceAtMs = now;
  const maintenancePromise = runTtsCacheMaintenance(options, now);
  inFlightMaintenance = maintenancePromise;

  try {
    return await maintenancePromise;
  } finally {
    if (inFlightMaintenance === maintenancePromise) {
      inFlightMaintenance = null;
    }
  }
}

async function runTtsCacheMaintenance(
  options: TtsCacheMaintenanceOptions,
  nowMs: number,
): Promise<TtsCacheMaintenanceResult> {
  const files = await collectCacheFiles(options.cacheDir);

  if (files.length === 0) {
    return {
      ran: true,
      scannedFiles: 0,
      deletedFiles: 0,
      reclaimedBytes: 0,
      remainingBytes: 0,
    };
  }

  const maxAgeMs = Math.max(0, options.maxAgeDays) * 24 * 60 * 60 * 1000;
  const maxBytes = Math.max(0, options.maxBytes);

  let deletedFiles = 0;
  let reclaimedBytes = 0;
  const remaining = [...files];

  if (maxAgeMs > 0) {
    for (const entry of files) {
      if (nowMs - entry.mtimeMs <= maxAgeMs) continue;
      if (await tryDeleteFile(entry.path)) {
        deletedFiles += 1;
        reclaimedBytes += entry.size;
      }
    }
  }

  for (let idx = remaining.length - 1; idx >= 0; idx -= 1) {
    const file = remaining[idx];
    if (!file) continue;
    const agedOut = maxAgeMs > 0 && nowMs - file.mtimeMs > maxAgeMs;
    if (agedOut) {
      remaining.splice(idx, 1);
    }
  }

  if (maxBytes > 0) {
    let totalBytes = remaining.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > maxBytes) {
      remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const entry of remaining) {
        if (totalBytes <= maxBytes) break;
        if (await tryDeleteFile(entry.path)) {
          deletedFiles += 1;
          reclaimedBytes += entry.size;
          totalBytes -= entry.size;
          entry.size = 0;
        }
      }
    }
  }

  const remainingBytes = Math.max(
    0,
    remaining.reduce((sum, file) => sum + file.size, 0),
  );

  return {
    ran: true,
    scannedFiles: files.length,
    deletedFiles,
    reclaimedBytes,
    remainingBytes,
  };
}

async function collectCacheFiles(cacheDir: string): Promise<TtsCacheFileEntry[]> {
  const root = path.resolve(cacheDir);
  const entries: TtsCacheFileEntry[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let children: Dirent[];
    try {
      children = await fs.readdir(current, { withFileTypes: true });
    } catch (error: unknown) {
      if (isMissingPathError(error)) {
        continue;
      }
      throw error;
    }

    for (const child of children) {
      const fullPath = path.join(current, child.name);
      if (child.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!child.isFile()) continue;

      try {
        const stats = await fs.stat(fullPath);
        entries.push({
          path: fullPath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        });
      } catch (error: unknown) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
    }
  }

  return entries;
}

async function tryDeleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error: unknown) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
