/**
 * Shared environment variable loading utilities.
 * Consolidates orchestrator's loadEnvFiles and batch-backend's config helpers.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export interface LoadEnvOptions {
  cwd?: string;
  files?: string[];
  override?: boolean;
  assignToProcess?: boolean;
  memoize?: boolean;
  memoizeKey?: string;
}

export interface LoadEnvSummary {
  loadedFiles: string[];
  missingFiles: string[];
  assignedKeys: string[];
  overriddenKeys: string[];
}

type EnvFileMeta = { path: string; mtimeMs: number; size: number; exists: boolean };

type EnvCacheEntry = {
  collected: Record<string, string>;
  loadedFiles: string[];
  missingFiles: string[];
  assignedKeys: string[];
  overriddenKeys: string[];
  metas: EnvFileMeta[];
};

const envCache = new Map<string, EnvCacheEntry>();

function statFile(path: string): EnvFileMeta {
  try {
    const stats = statSync(path);
    return { path, mtimeMs: stats.mtimeMs, size: stats.size, exists: true };
  } catch {
    return { path, mtimeMs: 0, size: 0, exists: false };
  }
}

function buildCacheKey(opts: {
  cwd: string;
  files: string[];
  override: boolean;
  assignToProcess: boolean;
  memoizeKey?: string;
}): string {
  return JSON.stringify({
    cwd: opts.cwd,
    files: opts.files,
    override: opts.override,
    assignToProcess: opts.assignToProcess,
    memoizeKey: opts.memoizeKey ?? '',
  });
}

/**
 * Load environment variables from .env files
 * Based on orchestrator/src/pipeline.ts:loadEnvFiles
 */
export function loadEnvFiles(options: LoadEnvOptions = {}): Record<string, string> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const files = (options.files && options.files.length > 0 ? options.files : ['.env']).map(
    (file) => (isAbsolute(file) ? file : resolve(cwd, file)),
  );
  const override = options.override ?? false;
  const assignToProcess = options.assignToProcess ?? true;
  const memoize = options.memoize ?? false;

  const cacheKey = memoize ? buildCacheKey({ cwd, files, override, assignToProcess, memoizeKey: options.memoizeKey }) : null;
  const metas = files.map((file) => (existsSync(file) ? statFile(file) : { path: file, mtimeMs: 0, size: 0, exists: false }));

  if (memoize && cacheKey) {
    const cached = envCache.get(cacheKey);
    if (cached && cached.metas.length === metas.length) {
      const fresh = cached.metas.every((meta, idx) => {
        const current = metas[idx];
        return (
          meta.path === current.path &&
          meta.exists === current.exists &&
          meta.mtimeMs === current.mtimeMs &&
          meta.size === current.size
        );
      });
      if (fresh) {
        if (assignToProcess) {
          for (const [key, value] of Object.entries(cached.collected)) {
            if (override || process.env[key] === undefined) {
              process.env[key] = value;
            }
          }
        }
        return cached.collected;
      }
    }
  }

  const collected: Record<string, string> = {};

  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const content = readFileSync(file, 'utf8');
      const parsed = parseEnv(content);

      for (const [key, value] of Object.entries(parsed)) {
        if (value === undefined) continue;

        // Update collected map
        if (override || collected[key] === undefined) {
          collected[key] = value;
        }

        // Update process.env if requested
        if (assignToProcess && (override || process.env[key] === undefined)) {
          process.env[key] = value;
        }
      }
    } catch {
      // Ignore parsing errors to match dotenv behavior
    }
  }

  if (memoize && cacheKey) {
    envCache.set(cacheKey, {
      collected: { ...collected },
      loadedFiles: files.filter((file, idx) => metas[idx]?.exists),
      missingFiles: files.filter((file, idx) => !metas[idx]?.exists),
      assignedKeys: [],
      overriddenKeys: [],
      metas,
    });
  }

  return collected;
}

/**
 * Load env files and return a summary of what happened (without exposing values).
 */
export function loadEnvFilesWithSummary(options: LoadEnvOptions = {}): LoadEnvSummary {
  const cwd = resolve(options.cwd ?? process.cwd());
  const files = (options.files && options.files.length > 0 ? options.files : ['.env']).map(
    (file) => (isAbsolute(file) ? file : resolve(cwd, file)),
  );
  const override = options.override ?? false;
  const assignToProcess = options.assignToProcess ?? true;
  const memoize = options.memoize ?? false;
  const cacheKey = memoize ? buildCacheKey({ cwd, files, override, assignToProcess, memoizeKey: options.memoizeKey }) : null;

  const assignedKeys = new Set<string>();
  const overriddenKeys = new Set<string>();
  const collected: Record<string, string> = {};
  const loadedFiles: string[] = [];
  const missingFiles: string[] = [];

  const metas = files.map((file) => (existsSync(file) ? statFile(file) : { path: file, mtimeMs: 0, size: 0, exists: false }));

  if (memoize && cacheKey) {
    const cached = envCache.get(cacheKey);
    if (cached && cached.metas.length === metas.length) {
      const fresh = cached.metas.every((meta, idx) => {
        const current = metas[idx];
        return (
          meta.path === current.path &&
          meta.exists === current.exists &&
          meta.mtimeMs === current.mtimeMs &&
          meta.size === current.size
        );
      });
      if (fresh) {
        if (assignToProcess) {
          for (const [key, value] of Object.entries(cached.collected)) {
            const alreadySet = process.env[key] !== undefined;
            if (override || !alreadySet) {
              if (alreadySet) {
                overriddenKeys.add(key);
              } else {
                assignedKeys.add(key);
              }
              process.env[key] = value;
            }
          }
        }

        return {
          loadedFiles: cached.loadedFiles,
          missingFiles: cached.missingFiles,
          assignedKeys: [...assignedKeys],
          overriddenKeys: [...overriddenKeys],
        };
      }
    }
  }

  for (const file of files) {
    if (!existsSync(file)) {
      missingFiles.push(file);
      continue;
    }
    loadedFiles.push(file);
    try {
      const content = readFileSync(file, 'utf8');
      const parsed = parseEnv(content);

      for (const [key, value] of Object.entries(parsed)) {
        if (value === undefined) continue;

        const alreadyCollected = collected[key] !== undefined;
        if (override || !alreadyCollected) {
          collected[key] = value;
        }

        if (assignToProcess) {
          const alreadySet = process.env[key] !== undefined;
          if (override || !alreadySet) {
            if (alreadySet) {
              overriddenKeys.add(key);
            } else {
              assignedKeys.add(key);
            }
            process.env[key] = value;
          }
        }
      }
    } catch {
      // Ignore parsing errors to match dotenv behavior
    }
  }

  if (memoize && cacheKey) {
    envCache.set(cacheKey, {
      collected: { ...collected },
      loadedFiles: [...loadedFiles],
      missingFiles: [...missingFiles],
      assignedKeys: [...assignedKeys],
      overriddenKeys: [...overriddenKeys],
      metas,
    });
  }

  return {
    loadedFiles,
    missingFiles,
    assignedKeys: [...assignedKeys],
    overriddenKeys: [...overriddenKeys],
  };
}

/**
 * Read boolean from environment with default
 * Based on batch-backend/src/config/env.ts:readBool
 */
export function readBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true';
}

/**
 * Read integer from environment with default
 * Based on batch-backend/src/config/env.ts:readInt
 */
export function readInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Read string from environment with default
 * Based on batch-backend/src/config/env.ts:readString
 */
export function readString(name: string, def?: string): string | undefined {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return v;
}
