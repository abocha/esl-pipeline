#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ARTIFACT_DIR,
  REPO_ROOT,
  normalizeEnvValue,
  writeJsonArtifact,
} from './telegram-ops-go-live-utils.mjs';

const DEFAULT_JSON_OUT = path.join(DEFAULT_ARTIFACT_DIR, 'ga-gates.json');
const GATE_STEPS = [
  { id: 'check_fast', command: 'pnpm', args: ['check:fast'] },
  {
    id: 'telegram_ops_bot_tests',
    command: 'pnpm',
    args: ['--filter', '@esl-pipeline/telegram-ops-bot', 'test'],
  },
  { id: 'integration_tests', command: 'pnpm', args: ['test:integration'] },
  {
    id: 'compose_smoke',
    command: 'bash',
    args: ['scripts/smoke/run-telegram-ops-compose-smoke.sh'],
  },
  {
    id: 'preflight_readonly_canary',
    command: 'pnpm',
    args: ['ops:telegram:preflight', '--profile=readonly_canary'],
  },
];

function printUsage() {
  console.log('Usage: node scripts/release/telegram-ops-go-live-gates.mjs [--json-out <path>]');
}

function parseArgs(argv) {
  const args = {
    jsonOutPath: DEFAULT_JSON_OUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json-out') {
      args.jsonOutPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--json-out=')) {
      args.jsonOutPath = token.slice('--json-out='.length);
      continue;
    }
    if (token === '-h' || token === '--help') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!normalizeEnvValue(args.jsonOutPath)) {
    throw new Error('--json-out cannot be empty');
  }
  return args;
}

function buildGateEnv(baseEnv) {
  const env = {
    ...baseEnv,
  };
  if (process.platform === 'linux') {
    const tmpRoot = normalizeEnvValue(env.TMPDIR) || '/tmp';
    env.TMPDIR = tmpRoot;
    if (!normalizeEnvValue(env.TMP)) {
      env.TMP = tmpRoot;
    }
    if (!normalizeEnvValue(env.TEMP)) {
      env.TEMP = tmpRoot;
    }
  }
  return env;
}

function runGateStep(step, env) {
  const result = spawnSync(step.command, step.args, {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    id: step.id,
    command: `${step.command} ${step.args.join(' ')}`.trim(),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    failedToStart: result.error ? String(result.error.message ?? result.error) : null,
  };
}

export async function runGates(args = {}) {
  const env = buildGateEnv(args.env ?? process.env);
  const jsonOutPath = args.jsonOutPath ?? DEFAULT_JSON_OUT;
  const runStep = args.runStep ?? runGateStep;

  const steps = [];
  let failedStepId = null;

  for (const step of GATE_STEPS) {
    const result = runStep(step, env);
    steps.push(result);
    if (result.exitCode !== 0) {
      failedStepId = step.id;
      break;
    }
  }

  const summary = {
    total: GATE_STEPS.length,
    executed: steps.length,
    passed: failedStepId === null,
    failedStepId,
  };
  const report = {
    kind: 'telegram_ops_go_live_gates',
    version: 1,
    generatedAt: new Date().toISOString(),
    summary,
    steps,
  };
  const artifactPath = await writeJsonArtifact(jsonOutPath, report);
  return {
    report: {
      ...report,
      artifactPath,
    },
    exitCode: summary.passed ? 0 : 1,
  };
}

function printReport(report) {
  console.log('[telegram-ops-go-live-gates]');
  console.log(`- artifact: ${report.artifactPath}`);
  for (const step of report.steps) {
    const prefix = step.exitCode === 0 ? 'PASS' : 'FAIL';
    console.log(`${prefix} ${step.id}: ${step.command}`);
  }
  console.log(
    `- summary: passed=${report.summary.passed} executed=${report.summary.executed}/${report.summary.total}` +
      (report.summary.failedStepId ? ` failedStep=${report.summary.failedStepId}` : ''),
  );
}

async function main() {
  let parsedArgs;
  try {
    parsedArgs = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[telegram-ops-go-live-gates] error: ${error instanceof Error ? error.message : String(error)}`,
    );
    printUsage();
    process.exit(1);
  }

  const result = await runGates(parsedArgs);
  printReport(result.report);
  process.exit(result.exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(
      `[telegram-ops-go-live-gates] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
    process.exit(1);
  });
}

export { DEFAULT_JSON_OUT, parseArgs, buildGateEnv, GATE_STEPS };
