#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAffectedCheckPlan,
  collectChangedFiles,
  formatPlanSummary,
  readWorkspacePackages,
  resolveComparisonBase,
} from './affected-check-lib.mjs';
import {
  buildAgentCheckArtifacts,
  buildAgentCheckSummary,
  buildSpawnInvocation,
  compactSignal,
  formatAgentCheckSummary,
  resolvePackageManagerCommand,
} from './agent-check-lib.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cliArgs = process.argv.slice(2);
const agentMode = cliArgs.includes('--agent');
const dryRun = cliArgs.includes('--dry-run');
const baseRef = readOption('--base') ?? 'origin/main';
const runLabel = agentMode ? 'check:fast:agent' : 'check:fast';
const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
const startedMs = Date.now();

const runArtifacts = buildAgentCheckArtifacts({
  repoRoot,
  runLabel,
  lane: 'summary',
  timestamp,
});
mkdirSync(runArtifacts.runDir, { recursive: true });

let plan;
try {
  const base = await resolveComparisonBase({
    baseRef,
    runGit,
  });
  const changedFiles = await collectChangedFiles({
    mergeBase: base.mergeBase,
    runGit,
  });
  const workspacePackages = readWorkspacePackages(repoRoot);
  plan = buildAffectedCheckPlan({
    baseRef: base.baseRef,
    mergeBase: base.mergeBase,
    changedFiles,
    workspacePackages,
  });
} catch (error) {
  plan = buildBaseFailurePlan({
    baseRef,
    reason: error instanceof Error ? error.message : String(error),
  });
}

const planText = formatPlanSummary(plan);
writeFileSync(path.join(runArtifacts.runDir, 'plan.txt'), `${planText}\n`, 'utf8');
writeFileSync(
  path.join(runArtifacts.runDir, 'plan.json'),
  `${JSON.stringify(plan, null, 2)}\n`,
  'utf8',
);

if (dryRun) {
  console.log(planText);
  console.log(`Artifacts: ${relativeArtifactPath(runArtifacts.runDir)}`);
  process.exit(plan.fallback ? 1 : 0);
}

if (!agentMode) {
  console.log(planText);
  console.log('');
}

const laneResults = [];
const lanes = buildExecutionLanes(plan);
for (const lane of lanes) {
  const result = await runLane(lane);
  laneResults.push(result);
  if (!agentMode) {
    console.log(`${result.status === 'pass' ? 'PASS' : 'FAIL'} ${result.name}`);
  }
  if (result.status !== 'pass') break;
}

const summary = buildAgentCheckSummary({
  label: agentMode ? 'check:fast:agent' : 'check:fast',
  durationMs: Date.now() - startedMs,
  lanes: laneResults,
});
writeFileSync(runArtifacts.summaryJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

if (agentMode) {
  console.log(planText);
  console.log('');
}
console.log(
  formatAgentCheckSummary(summary, {
    logsDir: relativeArtifactPath(runArtifacts.runDir),
  }),
);

if (plan.turbo) {
  const summaryPath = findNewestTurboSummary();
  if (summaryPath) {
    console.log(`turbo summary ${relativeArtifactPath(summaryPath)}`);
  }
}

process.exit(summary.firstFailure?.exitCode ?? 0);

function buildExecutionLanes(currentPlan) {
  const preTurboLanes = currentPlan.triggeredLanes.filter(
    (lane) => !lane.id.startsWith('backend:'),
  );
  const postTurboLanes = currentPlan.triggeredLanes.filter((lane) =>
    lane.id.startsWith('backend:'),
  );
  const lanes = [...preTurboLanes.map((lane) => ({ ...lane, kind: 'pnpm' }))];
  if (currentPlan.turbo) {
    lanes.push(
      ...currentPlan.turbo.taskGroups.map((group) => ({
        id: group.id,
        pnpmArgs: group.args,
        reason: `affected workspace package ${group.task} graph`,
        repro: group.repro,
        kind: 'pnpm',
      })),
    );
  }
  lanes.push(...postTurboLanes.map((lane) => ({ ...lane, kind: 'pnpm' })));
  return lanes;
}

async function runLane(lane) {
  const artifacts = buildAgentCheckArtifacts({
    repoRoot,
    runLabel,
    lane: lane.id,
    timestamp,
  });
  mkdirSync(artifacts.laneDir, { recursive: true });

  const laneStartedMs = Date.now();
  const result = await runCommand(resolvePackageManagerCommand(lane.pnpmArgs));
  writeFileSync(artifacts.rawLog, result.output, 'utf8');

  return {
    name: lane.id,
    status: result.exitCode === 0 ? 'pass' : 'fail',
    exitCode: result.exitCode,
    durationMs: Date.now() - laneStartedMs,
    signal: compactSignal(result.output),
    repro: lane.repro,
    artifacts: {
      rawLog: relativeArtifactPath(artifacts.rawLog),
    },
  };
}

function runGit(args) {
  return runCommand({
    command: 'git',
    args,
  }).then((result) => {
    if (result.exitCode !== 0) {
      const error = new Error(compactSignal(result.output) || `git ${args.join(' ')} failed`);
      error.exitCode = result.exitCode;
      throw error;
    }
    return result.output;
  });
}

function runCommand(invocation) {
  return new Promise((resolve, reject) => {
    const spawnInvocation = buildSpawnInvocation(invocation);
    const child = spawn(spawnInvocation.command, spawnInvocation.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    const timer = setTimeout(
      () => {
        child.kill('SIGTERM');
      },
      Number(process.env.CHECK_FAST_COMMAND_TIMEOUT_MS ?? 900_000),
    );

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        resolve({ exitCode: 1, output: `${output}\nProcess exited via signal ${signal}\n` });
        return;
      }
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

function buildBaseFailurePlan({ baseRef, reason }) {
  return {
    baseRef,
    mergeBase: '(unavailable)',
    changedFiles: [],
    changedPackages: [],
    affectedPackages: [],
    dependencyPackages: [],
    triggeredLanes: [
      {
        id: 'check:pre-pr',
        pnpmArgs: ['run', 'check:pre-pr'],
        reason,
        repro: 'pnpm run check:pre-pr',
      },
    ],
    skippedBroadLanes: [],
    turbo: null,
    fallback: {
      lane: 'check:pre-pr',
      reason,
    },
  };
}

function findNewestTurboSummary() {
  const runsDir = path.join(repoRoot, '.turbo', 'runs');
  try {
    return readdirSync(runsDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => path.join(runsDir, entry))
      .sort()
      .at(-1);
  } catch {
    return null;
  }
}

function readOption(name) {
  const index = cliArgs.indexOf(name);
  if (index === -1) return null;
  return cliArgs[index + 1] ?? null;
}

function relativeArtifactPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}
