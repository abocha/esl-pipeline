#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertProductionEnv, assertRuntimeSecrets } from '../deploy/production-paths.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const composeFile = path.join(rootDir, 'docker-compose.prod.yml');
const projectName = 'esl-pipeline-prod';
const placeholderSha = '0000000000000000000000000000000000000000';
const placeholderPrefix = 'ghcr.io/abocha/esl-pipeline';

const args = process.argv.slice(2);
const placeholderIndex = args.indexOf('--placeholder-images');
const usePlaceholderImages = placeholderIndex !== -1;
if (usePlaceholderImages) {
  args.splice(placeholderIndex, 1);
}

if (args.length === 0) {
  console.error('Usage: prod-compose.mjs [--placeholder-images] <docker compose args...>');
  process.exit(1);
}

const env = { ...process.env };
env.ESL_PRODUCTION_ENV_FILE ??= '/etc/esl-pipeline/production.env';
if (rootDir === '/opt/esl-pipeline') {
  assertProductionEnv(env.ESL_PRODUCTION_ENV_FILE, rootDir);
  assertRuntimeSecrets(rootDir);
}
if (usePlaceholderImages) {
  env.BATCH_BACKEND_IMAGE ??= `${placeholderPrefix}/batch-backend:${placeholderSha}`;
  env.BATCH_FRONTEND_IMAGE ??= `${placeholderPrefix}/batch-frontend:${placeholderSha}`;
  env.TELEGRAM_OPS_BOT_IMAGE ??= `${placeholderPrefix}/telegram-ops-bot:${placeholderSha}`;
}

const child = spawn(
  'docker',
  [
    'compose',
    '-p',
    projectName,
    '-f',
    composeFile,
    '--env-file',
    env.ESL_PRODUCTION_ENV_FILE,
    ...args,
  ],
  {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`docker compose exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
