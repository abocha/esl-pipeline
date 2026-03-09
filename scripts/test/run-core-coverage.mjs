#!/usr/bin/env node
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const coverageRoot = path.resolve('tmp/coverage');
const targets = [
  { key: 'batch-frontend', packageName: '@esl-pipeline/batch-frontend' },
  { key: 'batch-backend', packageName: '@esl-pipeline/batch-backend' },
  { key: 'orchestrator', packageName: '@esl-pipeline/orchestrator' },
  { key: 'tts-elevenlabs', packageName: '@esl-pipeline/tts-elevenlabs' },
];

rmSync(coverageRoot, { recursive: true, force: true });
mkdirSync(coverageRoot, { recursive: true });

let failed = false;
for (const target of targets) {
  const reportsDirectory = `../../tmp/coverage/${target.key}`;
  const args = [
    '--filter',
    target.packageName,
    'run',
    'test:unit',
    '--coverage.enabled',
    '--coverage.reporter=json-summary',
    '--coverage.reporter=json',
    `--coverage.reportsDirectory=${reportsDirectory}`,
  ];

  console.log(`\n[coverage] ${target.packageName}`);
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
