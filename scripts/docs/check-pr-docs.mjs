#!/usr/bin/env node

import { formatCheckResult, readChangedFiles, runDocsChecks } from './docs-check-lib.mjs';
import { checkChangedMarkdownLinks } from './pr-markdown-links.mjs';

const repoRoot = process.cwd();

try {
  const from = requireOption('--from');
  const to = requireOption('--to');
  const changedFiles = readChangedFiles({ repoRoot, from, to });
  const results = ['core', 'ops', 'non_core'].map((scope) =>
    runDocsChecks(scope, {
      repoRoot,
      freshnessMode: 'pr',
    }),
  );
  const output = results.map(formatCheckResult).join('\n\n');
  const markdownLinks = checkChangedMarkdownLinks({ repoRoot, from, to, changedFiles });
  const markdownLinkOutput = formatMarkdownLinkResult(markdownLinks);

  if (results.some((result) => result.errors.length > 0) || markdownLinks.errors.length > 0) {
    console.error([output, markdownLinkOutput].filter(Boolean).join('\n\n'));
    process.exitCode = 1;
  } else {
    console.log([output, markdownLinkOutput].filter(Boolean).join('\n\n'));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function formatMarkdownLinkResult(result) {
  const status = result.errors.length > 0 ? 'failed' : 'none detected';
  const lines = [
    `local Markdown link regressions: ${status} (${result.filesChecked} authored sources scanned)`,
  ];
  for (const error of result.errors) lines.push(`- ${error}`);
  return lines.join('\n');
}

function requireOption(name) {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
