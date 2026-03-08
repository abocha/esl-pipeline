#!/usr/bin/env node
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const timingsRoot = path.resolve('tmp/test-timings');

rmSync(timingsRoot, { recursive: true, force: true });
mkdirSync(timingsRoot, { recursive: true });

const args = [
  '--filter',
  '@esl-pipeline/batch-frontend',
  'run',
  'test:unit:timings',
];

console.log('[timings] running @esl-pipeline/batch-frontend test:unit with JSON reporter');
const result = spawnSync('pnpm', args, { stdio: 'inherit' });
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
