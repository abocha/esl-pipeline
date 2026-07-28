#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveValidationLaneEnv } from '../test/pure-test-env.mjs';
import {
  buildAffectedCheckPlan,
  buildBroadCheckPlan,
  buildCiScopeDecision,
  collectChangedFileScopes,
  formatPlanSummary,
  formatScopePreview,
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
import { buildExecutionLanes, runExecutionLanes } from './execution-lane-lib.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cliArgs = process.argv.slice(2);
const agentMode = cliArgs.includes('--agent');
const dryRun = cliArgs.includes('--dry-run');
const broadRun = cliArgs.includes('--broad');
const baseRef = readOption('--base') ?? 'origin/main';
const runLabel = broadRun
  ? agentMode
    ? 'check:pre-pr:agent'
    : 'check:pre-pr'
  : agentMode
    ? 'check:fast:agent'
    : 'check:fast';
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
let hostedDecision;
let uncommittedFiles = [];
try {
  if (broadRun) {
    plan = buildBroadCheckPlan({ reason: 'explicit broad validation requested' });
    hostedDecision = broadHostedDecision();
  } else {
    const base = await resolveComparisonBase({
      baseRef,
      runGit,
    });
    const scopes = await collectChangedFileScopes({
      mergeBase: base.mergeBase,
      runGit,
    });
    const workspacePackages = readWorkspacePackages(repoRoot);
    plan = buildAffectedCheckPlan({
      baseRef: base.baseRef,
      mergeBase: base.mergeBase,
      changedFiles: scopes.localFiles,
      workspacePackages,
    });
    hostedDecision = buildCiScopeDecision({
      changedFileRecords: scopes.hostedRecords,
      workspacePackages,
    });
    uncommittedFiles = scopes.uncommittedFiles;
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  plan = buildBroadCheckPlan({
    baseRef,
    mergeBase: '(unavailable)',
    reason,
    fallback: true,
  });
  hostedDecision = broadHostedDecision('comparison-base-failure', reason);
}

const planText = formatPlanSummary(plan);
writeFileSync(path.join(runArtifacts.runDir, 'plan.txt'), `${planText}\n`, 'utf8');
writeFileSync(
  path.join(runArtifacts.runDir, 'plan.json'),
  `${JSON.stringify(plan, null, 2)}\n`,
  'utf8',
);

if (dryRun) {
  console.log(formatScopePreview({ planText, hostedDecision, uncommittedFiles }));
  console.log(`Artifacts: ${relativeArtifactPath(runArtifacts.runDir)}`);
  process.exit(plan.fallback && !broadRun ? 1 : 0);
}

if (!agentMode) {
  console.log(planText);
  console.log('');
}

const lanes = buildExecutionLanes(plan);
const laneResults = await runExecutionLanes({
  lanes,
  runLane,
  onResult(result) {
    if (!agentMode) {
      const status = result.status === 'pass' ? 'PASS' : result.status.toUpperCase();
      console.log(`${status} ${result.name}`);
    }
  },
});

const summary = buildAgentCheckSummary({
  label: runLabel,
  durationMs: Date.now() - startedMs,
  lanes: laneResults,
  ciRequirements: plan.ciRequirements,
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

process.exit(summary.firstFailure?.exitCode ?? (summary.problems.length > 0 ? 1 : 0));

async function runLane(lane) {
  const artifacts = buildAgentCheckArtifacts({
    repoRoot,
    runLabel,
    lane: lane.id,
    timestamp,
  });
  mkdirSync(artifacts.laneDir, { recursive: true });

  const laneStartedMs = Date.now();
  const result = await runCommand(resolvePackageManagerCommand(lane.pnpmArgs), {
    env: resolveValidationLaneEnv({ laneId: lane.id, sourceEnv: process.env }),
  });
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

function runCommand(invocation, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const spawnInvocation = buildSpawnInvocation(invocation);
    const child = spawn(spawnInvocation.command, spawnInvocation.args, {
      cwd: repoRoot,
      env,
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

function broadHostedDecision(
  code = 'explicit-broad-validation',
  subject = 'explicit broad validation requested',
) {
  return {
    runtime: true,
    integration: true,
    backend_db_worker: true,
    telegram: true,
    docs_only: false,
    changedFiles: [],
    affectedPackages: [],
    reasons: [{ code, scope: 'all', subject }],
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
