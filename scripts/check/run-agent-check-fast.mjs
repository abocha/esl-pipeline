#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgentCheckArtifacts,
  buildAgentCheckSummary,
  buildSpawnInvocation,
  compactSignal,
  formatAgentCheckSummary,
  resolvePackageManagerCommand,
} from './agent-check-lib.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runLabel = 'check:fast';
const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
const runArtifacts = buildAgentCheckArtifacts({
  repoRoot,
  runLabel,
  lane: 'summary',
  timestamp,
});

const lanes = [
  {
    name: 'guard-orchestrator-boundary',
    pnpmArgs: ['guard:orchestrator:boundary'],
    repro: 'pnpm guard:orchestrator:boundary',
  },
  {
    name: 'release-verify-contracts',
    pnpmArgs: ['release:verify:contracts'],
    repro: 'pnpm release:verify:contracts',
  },
  {
    name: 'build',
    pnpmArgs: ['build'],
    repro: 'pnpm build',
  },
  {
    name: 'lint',
    pnpmArgs: ['lint'],
    repro: 'pnpm lint',
  },
  {
    name: 'test-unit-prebuilt-fast-agent',
    pnpmArgs: ['--silent', 'run', 'test:unit:prebuilt:fast:agent'],
    repro: 'pnpm --silent run test:unit:prebuilt:fast:agent',
  },
];

mkdirSync(runArtifacts.runDir, { recursive: true });

const startedMs = Date.now();
const laneResults = [];

for (const lane of lanes) {
  const artifacts = buildAgentCheckArtifacts({
    repoRoot,
    runLabel,
    lane: lane.name,
    timestamp,
  });
  mkdirSync(artifacts.laneDir, { recursive: true });

  const laneStartedMs = Date.now();
  const result = await runCommand(resolvePackageManagerCommand(lane.pnpmArgs));
  writeFileSync(artifacts.rawLog, result.output, 'utf8');

  const laneResult = {
    name: lane.name,
    status: result.exitCode === 0 ? 'pass' : 'fail',
    exitCode: result.exitCode,
    durationMs: Date.now() - laneStartedMs,
    signal: compactSignal(result.output),
    repro: lane.repro,
    artifacts: {
      rawLog: relativeArtifactPath(artifacts.rawLog),
    },
  };
  laneResults.push(laneResult);

  if (laneResult.status !== 'pass') {
    break;
  }
}

const summary = buildAgentCheckSummary({
  label: 'check:fast:agent',
  durationMs: Date.now() - startedMs,
  lanes: laneResults,
});
writeFileSync(runArtifacts.summaryJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(
  formatAgentCheckSummary(summary, {
    logsDir: relativeArtifactPath(runArtifacts.runDir),
  }),
);

process.exit(summary.firstFailure?.exitCode ?? 0);

function runCommand(invocation) {
  return new Promise((resolve, reject) => {
    const spawnInvocation = buildSpawnInvocation(invocation);
    const child = spawn(spawnInvocation.command, spawnInvocation.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve({ exitCode: 1, output: `${output}\nProcess exited via signal ${signal}\n` });
        return;
      }
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

function relativeArtifactPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}
