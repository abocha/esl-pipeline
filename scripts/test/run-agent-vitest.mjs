#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgentVitestSummary,
  formatAgentVitestSummary,
  withAgentVitestArgs,
} from './agent-vitest-lib.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { label, command } = parseArgs(process.argv.slice(2));
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/gu, '-');
const safeLabel = label.replace(/[^a-zA-Z0-9_.-]+/gu, '-').replace(/^-|-$/gu, '') || 'vitest';
const outputDir = path.join(repoRoot, 'tmp', 'test-logs', `${stamp}-${safeLabel}`);
const jsonPath = path.join(outputDir, 'vitest.json');
const rawLogPath = path.join(outputDir, 'raw.log');

mkdirSync(outputDir, { recursive: true });

const vitestArgs = withAgentVitestArgs(command.args, jsonPath);
const startedMs = Date.now();
const result = await runCommand(command.command, vitestArgs);
const durationMs = Date.now() - startedMs;

writeFileSync(rawLogPath, result.output, 'utf8');

let summary;
try {
  summary = buildAgentVitestSummary({
    command: [command.command, ...command.args],
    cwd: process.cwd(),
    durationMs,
    json: JSON.parse(readFileSync(jsonPath, 'utf8')),
  });
} catch (error) {
  console.error(`vitest ${label} FAIL  ${formatDuration(durationMs)}`);
  console.error(
    `unable to read vitest json: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error(`raw log: ${relativeArtifactPath(rawLogPath)}`);
  console.error(`json: ${relativeArtifactPath(jsonPath)}`);
  process.exit(result.exitCode || 1);
}

console.log(
  formatAgentVitestSummary(summary, {
    label,
    artifacts: {
      rawLog: relativeArtifactPath(rawLogPath),
      json: relativeArtifactPath(jsonPath),
    },
  }),
);

process.exit(result.exitCode);

function parseArgs(args) {
  let label = 'vitest';
  const separatorIndex = args.indexOf('--');
  const optionArgs = separatorIndex === -1 ? [] : args.slice(0, separatorIndex);
  const commandArgs = separatorIndex === -1 ? args : args.slice(separatorIndex + 1);

  for (let index = 0; index < optionArgs.length; index += 1) {
    if (optionArgs[index] === '--label') {
      label = optionArgs[index + 1] || label;
      index += 1;
    }
  }

  if (commandArgs.length === 0) {
    throw new Error('Usage: run-agent-vitest.mjs [--label name] -- vitest run [args...]');
  }

  const [command, ...commandRest] = commandArgs;
  return {
    label,
    command: {
      command: resolveCommand(command),
      args: commandRest,
    },
  };
}

function resolveCommand(command) {
  if (process.platform === 'win32' && !/\.(?:cmd|exe|bat)$/iu.test(command)) {
    return `${command}.cmd`;
  }
  return command;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const invocation = buildSpawnInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
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

function buildSpawnInvocation(command, args) {
  if (process.platform !== 'win32') {
    return { command, args };
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')],
  };
}

function quoteCmdArg(arg) {
  if (/^[a-zA-Z0-9_./:@%+=,\\-]+$/u.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/(["^&|<>])/gu, '^$1')}"`;
}

function relativeArtifactPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) {
    return `${Math.max(0, Math.round(ms || 0))}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
