#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const coverageRoot = path.resolve('tmp/coverage');
const targets = [
  { key: 'batch-frontend', packageName: '@esl-pipeline/batch-frontend' },
  { key: 'batch-backend', packageName: '@esl-pipeline/batch-backend' },
  { key: 'orchestrator', packageName: '@esl-pipeline/orchestrator' },
  { key: 'tts-elevenlabs', packageName: '@esl-pipeline/tts-provider-elevenlabs' },
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
  const invocation = resolvePackageManagerCommand(args);
  const result = spawnSync(invocation.command, invocation.args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to run package manager: ${result.error.message}`);
  }
  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}

function resolvePackageManagerCommand(args) {
  const npmExecPath = normalizeEnvValue(process.env.npm_execpath);
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
  };
}

function normalizeEnvValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
