import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFilesWithSummary, type LoadEnvSummary } from './loaders.js';

/**
 * Standard env bootstrap for executable entrypoints (CLI, workers, one-off tools).
 * Prefer this helper over ad-hoc .env parsing in new entrypoints.
 */
export interface LoadCliEnvOptions {
  moduleUrl: string;
  cwd?: string;
  files?: string[];
  repoEnvRelativePath?: string;
  override?: boolean;
  assignToProcess?: boolean;
  memoize?: boolean;
  memoizeKey?: string;
}

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = (value ?? '').toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function findWorkspaceRoot(startDir: string): string | undefined {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function loadCliEnv(options: LoadCliEnvOptions): LoadEnvSummary {
  const moduleDir = dirname(fileURLToPath(options.moduleUrl));
  const workspaceRoot = findWorkspaceRoot(moduleDir);
  const repoEnvPath = options.repoEnvRelativePath
    ? resolve(moduleDir, options.repoEnvRelativePath)
    : workspaceRoot
      ? resolve(workspaceRoot, '.env')
      : resolve(moduleDir, '../../../.env');
  const baseFiles = options.files && options.files.length > 0 ? options.files : ['.env'];
  const envFiles = existsSync(repoEnvPath) ? [...baseFiles, repoEnvPath] : baseFiles;
  const memoize = options.memoize ?? isTruthyFlag(process.env.ESL_PIPELINE_CACHE_ENV);

  return loadEnvFilesWithSummary({
    cwd: options.cwd ?? process.cwd(),
    files: envFiles,
    override: options.override ?? false,
    assignToProcess: options.assignToProcess ?? true,
    memoize,
    memoizeKey: options.memoizeKey ?? 'cli',
  });
}
