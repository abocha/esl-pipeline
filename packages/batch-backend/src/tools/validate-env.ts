#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { loadConfig } from '../config/env.js';
import { loadMcpOAuthConfig } from '../transport/mcp-oauth.js';

type EnvProfile = 'development' | 'production';

export interface ValidateEnvironmentOptions {
  cwd?: string;
  profile?: EnvProfile;
  example?: boolean;
  runtime?: boolean;
  shellEnv?: NodeJS.ProcessEnv;
}

export interface EnvironmentValidationResult {
  errors: string[];
  warnings: string[];
  filePath: string;
}

const DEFAULT_JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';

function isEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? '');
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function parseProfile(value: string | undefined): EnvProfile {
  if (!value || value === 'development') return 'development';
  if (value === 'production') return 'production';
  throw new Error('--profile must be development or production.');
}

function findDuplicateKeys(contents: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const rawLine of contents.split(/\r?\n/u)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/^export\s+/u, '');
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(line);
    if (!match) continue;
    const key = match[1]!;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }

  return [...duplicates].sort();
}

function findMalformedLines(contents: string): string[] {
  const errors: string[] = [];

  for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/^export\s+/u, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/u.test(line)) {
      errors.push(`Malformed assignment at line ${index + 1}.`);
    }
  }

  return errors;
}

function addEnabledFeatureRequirements(env: NodeJS.ProcessEnv, errors: string[]): void {
  if (isEnabled(env.STUDENT_MEMORY_OPENAI_BATCH_ENABLED) && !hasValue(env.OPENAI_API_KEY)) {
    errors.push('STUDENT_MEMORY_OPENAI_BATCH_ENABLED=true requires OPENAI_API_KEY.');
  }

  if (isEnabled(env.ESL_TTS_SPEECH_PLANNER_ENABLED)) {
    const provider = env.ESL_TTS_SPEECH_PLANNER_PROVIDER?.trim() || 'openai';
    if (provider === 'openai' && !hasValue(env.OPENAI_API_KEY)) {
      errors.push(
        'ESL_TTS_SPEECH_PLANNER_ENABLED=true with provider openai requires OPENAI_API_KEY.',
      );
    }
  }

  if (isEnabled(env.ESL_TTS_VOICE_RANKER_ENABLED) && !hasValue(env.OPENAI_API_KEY)) {
    errors.push('ESL_TTS_VOICE_RANKER_ENABLED=true requires OPENAI_API_KEY.');
  }

  if (
    isEnabled(env.BATCH_BACKEND_ENABLE_OPS_CONTROL) &&
    !hasValue(env.BATCH_BACKEND_OPS_CONTROL_BOT_SECRET)
  ) {
    errors.push(
      'BATCH_BACKEND_ENABLE_OPS_CONTROL=true requires BATCH_BACKEND_OPS_CONTROL_BOT_SECRET.',
    );
  }

  if (isEnabled(env.TELEGRAM_OPS_BOT_ENABLED) && !hasValue(env.TELEGRAM_OPS_BOT_TOKEN)) {
    errors.push('TELEGRAM_OPS_BOT_ENABLED=true requires TELEGRAM_OPS_BOT_TOKEN.');
  }
}

function addProductionRequirements(env: NodeJS.ProcessEnv, errors: string[]): void {
  if (env.NODE_ENV !== 'production') {
    errors.push('Production profile requires NODE_ENV=production.');
  }
  if (!isEnabled(env.PG_ENABLED)) {
    errors.push('Production profile requires PG_ENABLED=true.');
  }
  if (!isEnabled(env.REDIS_ENABLED)) {
    errors.push('Production profile requires REDIS_ENABLED=true.');
  }
  if (!hasValue(env.JWT_SECRET) || env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    errors.push('Production profile requires a non-default JWT_SECRET.');
  }
  if (!isEnabled(env.REFRESH_COOKIE_SECURE)) {
    errors.push('Production profile requires REFRESH_COOKIE_SECURE=true.');
  }
  if (hasValue(env.CADDY_PUBLIC_HOSTNAME)) {
    if (hasValue(env.REFRESH_COOKIE_DOMAIN)) {
      errors.push(
        'Same-origin Caddy production requires host-only cookies: unset REFRESH_COOKIE_DOMAIN.',
      );
    }
    if (isEnabled(env.ENABLE_CORS)) {
      errors.push('Same-origin Caddy production requires ENABLE_CORS=false.');
    }
    if (hasValue(env.REFRESH_COOKIE_PATH) && env.REFRESH_COOKIE_PATH !== '/') {
      errors.push('Same-origin Caddy production requires REFRESH_COOKIE_PATH=/.');
    }
    if (env.MCP_OAUTH_ENABLED === 'true') {
      const origin = `https://${env.CADDY_PUBLIC_HOSTNAME}`;
      if (
        env.MCP_OAUTH_ISSUER !== `${origin}/api/oauth` ||
        env.MCP_OAUTH_RESOURCE !== `${origin}/api/mcp`
      ) {
        errors.push(
          'MCP OAuth issuer/resource must use the CADDY_PUBLIC_HOSTNAME canonical HTTPS origin.',
        );
      }
    }
  }
}

function validateBackendConfig(env: NodeJS.ProcessEnv, errors: string[]): void {
  const previousEnv = process.env;
  process.env = { ...env };
  try {
    const config = loadConfig();
    if (
      loadMcpOAuthConfig(config.auth.refreshCookieName) &&
      !config.experimental.extendedApiEnabled
    ) {
      errors.push('MCP_OAUTH_ENABLED=true requires BATCH_BACKEND_ENABLE_EXTENDED_API=true.');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    process.env = previousEnv;
  }
}

export function validateEnvironment(
  options: ValidateEnvironmentOptions = {},
): EnvironmentValidationResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const canonicalFile = path.join(cwd, '.env');
  const legacyFile = path.join(cwd, '.env.batch-backend');
  const exampleFile = path.join(cwd, '.env.example');
  const profile = options.profile ?? 'development';
  const warnings: string[] = [];
  const errors: string[] = [];
  const filePath = options.example ? exampleFile : canonicalFile;

  if (options.runtime) {
    if (options.example) {
      errors.push('--runtime cannot be combined with --example.');
    } else {
      const env = { ...(options.shellEnv ?? process.env) };
      validateBackendConfig(env, errors);
      addEnabledFeatureRequirements(env, errors);
      if (profile === 'production') addProductionRequirements(env, errors);
    }
    return { errors, warnings, filePath: 'runtime environment' };
  }

  if (!options.example && existsSync(canonicalFile) && existsSync(legacyFile)) {
    errors.push('Found both .env and .env.batch-backend. Rename or remove the legacy file.');
    return { errors, warnings, filePath };
  }

  const sourcePath =
    !options.example && !existsSync(canonicalFile) && existsSync(legacyFile)
      ? legacyFile
      : filePath;
  if (sourcePath === legacyFile) {
    warnings.push('.env.batch-backend is deprecated; rename it to .env before the next release.');
  }

  if (!existsSync(sourcePath)) {
    errors.push(`Required environment file is missing: ${path.basename(sourcePath)}.`);
    return { errors, warnings, filePath: sourcePath };
  }

  const contents = readFileSync(sourcePath, 'utf8');
  errors.push(...findMalformedLines(contents));
  for (const key of findDuplicateKeys(contents)) {
    errors.push(`Duplicate key: ${key}`);
  }
  if (errors.length > 0) return { errors, warnings, filePath: sourcePath };

  let parsed: NodeJS.ProcessEnv;
  try {
    parsed = parseEnv(contents);
  } catch {
    errors.push('Environment file could not be parsed.');
    return { errors, warnings, filePath: sourcePath };
  }

  const env = { ...parsed, ...(options.shellEnv ?? process.env) };
  validateBackendConfig(env, errors);
  addEnabledFeatureRequirements(env, errors);
  if (profile === 'production') addProductionRequirements(env, errors);

  return { errors, warnings, filePath: sourcePath };
}

function parseCliOptions(argv: string[]): ValidateEnvironmentOptions {
  let profile: EnvProfile = 'development';
  let example = false;
  let runtime = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--example') {
      example = true;
      continue;
    }
    if (arg === '--runtime') {
      runtime = true;
      continue;
    }
    if (arg === '--profile') {
      profile = parseProfile(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg?.startsWith('--profile=')) {
      profile = parseProfile(arg.slice('--profile='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { profile, example, runtime };
}

function main(): void {
  const result = validateEnvironment(parseCliOptions(process.argv.slice(2)));
  for (const warning of result.warnings) console.warn(`[env_validate] ${warning}`);
  if (result.errors.length > 0) {
    console.error('Environment validation failed:');
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Environment validation passed (${path.basename(result.filePath)}).`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
