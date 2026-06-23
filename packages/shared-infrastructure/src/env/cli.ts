import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type LoadEnvSummary, loadEnvFilesWithSummary } from './loaders.js';

/**
 * Standard env bootstrap for executable entrypoints (CLI, workers, one-off tools).
 * Prefer this helper over ad-hoc .env parsing in new entrypoints.
 */
export interface LoadCliEnvOptions {
  moduleUrl: string;
  cwd?: string;
  files?: string[];
  repoEnvRelativePath?: string;
  includeRepoEnv?: boolean;
  override?: boolean;
  assignToProcess?: boolean;
  memoize?: boolean;
  memoizeKey?: string;
}

export interface LoadApplicationEnvOptions extends LoadCliEnvOptions {}

const CANONICAL_APPLICATION_ENV_FILE = '.env';
const LEGACY_APPLICATION_ENV_FILE = '.env.batch-backend';

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
  const includeRepoEnv = options.includeRepoEnv ?? true;
  const envFiles =
    includeRepoEnv && existsSync(repoEnvPath) ? [...baseFiles, repoEnvPath] : baseFiles;
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

/**
 * Load the one canonical application env file for direct CLI/tool entrypoints.
 *
 * `.env.batch-backend` is accepted for a single release only when `.env` is absent.
 * Compose and deployment scripts intentionally do not use this compatibility bridge.
 */
export function loadApplicationEnv(options: LoadApplicationEnvOptions): LoadEnvSummary {
  const moduleDir = dirname(fileURLToPath(options.moduleUrl));
  const workspaceRoot = findWorkspaceRoot(moduleDir);
  const cwd = resolve(options.cwd ?? workspaceRoot ?? process.cwd());
  const canonicalPath = resolve(cwd, CANONICAL_APPLICATION_ENV_FILE);
  const legacyPath = resolve(cwd, LEGACY_APPLICATION_ENV_FILE);
  const hasCanonical = existsSync(canonicalPath);
  const hasLegacy = existsSync(legacyPath);

  if (hasCanonical && hasLegacy) {
    throw new Error(
      'Found both .env and .env.batch-backend. Rename or remove the legacy file; application env files are never merged.',
    );
  }

  if (!hasCanonical && hasLegacy) {
    console.warn(
      '[env_deprecated] .env.batch-backend is deprecated and will stop loading after this release. Rename it to .env.',
    );
  }

  return loadCliEnv({
    ...options,
    cwd,
    files: [hasLegacy && !hasCanonical ? legacyPath : canonicalPath],
    includeRepoEnv: false,
  });
}
