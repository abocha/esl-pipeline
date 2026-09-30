#!/usr/bin/env node

import { formatCheckResult, readChangedFiles, runDocsChecks } from './docs-check-lib.mjs';

const repoRoot = process.cwd();

try {
  const from = requireOption('--from');
  const to = requireOption('--to');
  readChangedFiles({ repoRoot, from, to });
  const results = ['core', 'ops', 'non_core'].map((scope) =>
    runDocsChecks(scope, {
      repoRoot,
      freshnessMode: 'pr',
    }),
  );
  const output = results.map(formatCheckResult).join('\n\n');

  if (results.some((result) => result.errors.length > 0)) {
    console.error(output);
    process.exitCode = 1;
  } else {
    console.log(output);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function requireOption(name) {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
