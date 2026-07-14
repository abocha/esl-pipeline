#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCiScopeDecision,
  formatCiScopeGithubOutputs,
  formatCiScopeSummary,
  parseNameStatusZ,
  readWorkspacePackages,
} from './affected-check-lib.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);

try {
  const from = requireOption('--from');
  const to = requireOption('--to');
  const githubOutput = readOption('--github-output');
  const githubSummary = readOption('--github-summary');
  const output = await runGit([
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
    `${from}...${to}`,
  ]);
  const changedFileRecords = parseNameStatusZ(output);
  if (changedFileRecords.length === 0) {
    throw new Error(`committed diff ${from}...${to} is empty`);
  }

  const decision = buildCiScopeDecision({
    changedFileRecords,
    workspacePackages: readWorkspacePackages(repoRoot),
  });
  const summary = formatCiScopeSummary(decision);
  console.log(summary);
  if (githubOutput) appendFileSync(githubOutput, formatCiScopeGithubOutputs(decision), 'utf8');
  if (githubSummary) appendFileSync(githubSummary, `${summary}\n`, 'utf8');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function requireOption(name) {
  const value = readOption(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function runGit(gitArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', gitArgs, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      reject(
        new Error(
          Buffer.concat(stderr).toString('utf8').trim() ||
            `git ${gitArgs.join(' ')} failed with exit code ${code ?? 1}`,
        ),
      );
    });
  });
}
