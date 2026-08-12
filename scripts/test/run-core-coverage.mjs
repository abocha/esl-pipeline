#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCoreCoveragePlan } from './core-coverage-plan.mjs';

const coverageRoot = path.resolve('tmp/coverage');

if (isMainModule()) {
  const plan = buildCoreCoveragePlan();

  rmSync(coverageRoot, { recursive: true, force: true });
  mkdirSync(coverageRoot, { recursive: true });

  console.log('\n[coverage] preparing workspace build graph');
  const preparationInvocation = resolvePackageManagerCommand(plan.preparation.args);
  const preparation = spawnSync(preparationInvocation.command, preparationInvocation.args, {
    stdio: 'inherit',
  });
  if (preparation.error) {
    console.error(`Failed to prepare workspace build graph: ${preparation.error.message}`);
  }
  if (preparation.status !== 0) {
    process.exitCode = 1;
  } else {
    runCoverage(plan.coverage);
  }
}

function runCoverage(targets) {
  let failed = false;
  for (const target of targets) {
    console.log(`\n[coverage] ${target.packageName}`);
    const invocation = resolvePackageManagerCommand(target.args);
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
}

function isMainModule() {
  return (
    process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  );
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
