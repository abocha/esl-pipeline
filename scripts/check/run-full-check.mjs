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
import {
  buildFullCheckLaneResult,
  buildFullCheckLanes,
  runFullCheckLanes,
} from './full-check-lib.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const agentMode = process.argv.slice(2).includes('--agent');
const runLabel = agentMode ? 'check:agent' : 'check';
const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
const startedMs = Date.now();
const runArtifacts = agentMode
  ? buildAgentCheckArtifacts({
      repoRoot,
      runLabel,
      lane: 'summary',
      timestamp,
    })
  : null;

if (runArtifacts) {
  mkdirSync(runArtifacts.runDir, { recursive: true });
}

const results = await runFullCheckLanes({
  lanes: buildFullCheckLanes(),
  runLane: agentMode ? runAgentLane : runHumanLane,
});
const firstFailure = results.find((result) => result.status !== 'pass') ?? null;

if (agentMode) {
  const summary = buildAgentCheckSummary({
    label: runLabel,
    durationMs: Date.now() - startedMs,
    lanes: results,
  });
  writeFileSync(runArtifacts.summaryJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(
    formatAgentCheckSummary(summary, {
      logsDir: relativeArtifactPath(runArtifacts.runDir),
    }),
  );
}

process.exit(firstFailure?.exitCode ?? 0);

async function runHumanLane(lane) {
  const startedMs = Date.now();
  const { exitCode } = await runCommand(resolvePackageManagerCommand(lane.pnpmArgs), {
    capture: false,
  });
  return buildFullCheckLaneResult({
    lane,
    exitCode,
    durationMs: Date.now() - startedMs,
    output: '',
  });
}

async function runAgentLane(lane) {
  const artifacts = buildAgentCheckArtifacts({
    repoRoot,
    runLabel,
    lane: lane.id,
    timestamp,
  });
  mkdirSync(artifacts.laneDir, { recursive: true });

  const startedMs = Date.now();
  const result = await runCommand(resolvePackageManagerCommand(lane.pnpmArgs), { capture: true });
  writeFileSync(artifacts.rawLog, result.output, 'utf8');
  return buildFullCheckLaneResult({
    lane,
    exitCode: result.exitCode,
    durationMs: Date.now() - startedMs,
    output: compactSignal(result.output),
    artifacts: { rawLog: relativeArtifactPath(artifacts.rawLog) },
  });
}

function runCommand(invocation, { capture }) {
  return new Promise((resolve) => {
    const spawnInvocation = buildSpawnInvocation(invocation);
    const child = spawn(spawnInvocation.command, spawnInvocation.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });

    let output = '';
    if (capture) {
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
    }
    child.on('error', (error) => {
      resolve({ exitCode: 1, output: `${output}${error.message}\n` });
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve({ exitCode: 1, output: `${output}Process exited via signal ${signal}\n` });
        return;
      }
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

function relativeArtifactPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}
