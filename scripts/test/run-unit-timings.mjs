#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const timingsRoot = path.resolve('tmp/test-timings');
const packages = [
  {
    key: 'batch-backend',
    name: '@esl-pipeline/batch-backend',
  },
  {
    key: 'batch-frontend',
    name: '@esl-pipeline/batch-frontend',
  },
  {
    key: 'orchestrator',
    name: '@esl-pipeline/orchestrator',
  },
  {
    key: 'telegram-ops-bot',
    name: '@esl-pipeline/telegram-ops-bot',
  },
  {
    key: 'tts-provider-elevenlabs',
    name: '@esl-pipeline/tts-provider-elevenlabs',
  },
  {
    key: 'html-publisher',
    name: '@esl-pipeline/html-publisher',
  },
];

rmSync(timingsRoot, { recursive: true, force: true });
mkdirSync(timingsRoot, { recursive: true });
for (const pkg of packages) {
  mkdirSync(path.join(timingsRoot, pkg.key), { recursive: true });
}

console.log(
  `[timings] running ${packages.map((pkg) => pkg.name).join(', ')} test:unit with JSON reporter`,
);

let exitCode = 0;
for (const pkg of packages) {
  const args = ['--filter', pkg.name, 'run', 'test:unit:timings'];
  console.log(`[timings] ${pkg.name} -> test:unit:timings`);
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0 && exitCode === 0) {
    exitCode = result.status ?? 1;
  }
}

if (exitCode !== 0) {
  process.exitCode = exitCode;
}
