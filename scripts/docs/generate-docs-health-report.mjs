#!/usr/bin/env node

import { readChangedFiles } from './docs-check-lib.mjs';
import { buildDocsHealthReport, writeDocsHealthReportArtifacts } from './docs-gardening-lib.mjs';

const repoRoot = process.cwd();
const prScoped = process.argv.includes('--pr');
const from = readOption('--from');
const to = readOption('--to');
const changedFiles = prScoped ? readChangedFiles({ repoRoot, from, to }) : undefined;
const report = buildDocsHealthReport({
  repoRoot,
  freshnessMode: prScoped ? 'pr' : 'full',
  changedFiles,
});
const artifacts = writeDocsHealthReportArtifacts(report, { repoRoot });

console.log(`docs health report written:\n- ${artifacts.jsonPath}\n- ${artifacts.mdPath}`);

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
