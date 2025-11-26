/**
 * Shared environment variable loading utilities.
 * Consolidates orchestrator's loadEnvFiles and batch-backend's config helpers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export interface LoadEnvOptions {
  cwd?: string;
  files?: string[];
  override?: boolean;
  assignToProcess?: boolean;
}

export interface LoadEnvSummary {
  loadedFiles: string[];
  missingFiles: string[];
  assignedKeys: string[];
  overriddenKeys: string[];
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

  const assignedKeys = new Set<string>();
  const overriddenKeys = new Set<string>();
  const collected: Record<string, string> = {};
  const loadedFiles: string[] = [];
  const missingFiles: string[] = [];

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
