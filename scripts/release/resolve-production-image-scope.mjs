#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorkspacePackages } from '../check/affected-check-lib.mjs';
import { buildProductionImageScope } from './production-image-scope.mjs';

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const changedFilesPath = valueAfter('--changed-files');
if (!changedFilesPath) throw new Error('--changed-files is required');

let changedFilePayload;
try {
  changedFilePayload = JSON.parse(readFileSync(changedFilesPath, 'utf8'));
} catch {
  changedFilePayload = undefined;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const result = buildProductionImageScope({
  changedFilePayload,
  workspacePackages: readWorkspacePackages(repoRoot),
});

const outputPath = valueAfter('--github-output') ?? process.env.GITHUB_OUTPUT;
if (!outputPath) throw new Error('--github-output or GITHUB_OUTPUT is required');
appendFileSync(
  outputPath,
  [
    `build_backend=${result.backend}`,
    `build_frontend=${result.frontend}`,
    `build_bot=${result.bot}`,
  ].join('\n') + '\n',
);

const summaryPath = valueAfter('--summary') ?? process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  appendFileSync(
    summaryPath,
    [
      '### Production image scope',
      '',
      `- Backend: ${result.backend ? 'build' : 'reuse'}`,
      `- Frontend: ${result.frontend ? 'build' : 'reuse'}`,
      `- Telegram bot: ${result.bot ? 'build' : 'reuse'}`,
      `- Reasons: ${result.reasons.join('; ')}`,
      '',
    ].join('\n'),
  );
}
