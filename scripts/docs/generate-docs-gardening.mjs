#!/usr/bin/env node
import path from 'node:path';

import { buildDocsGardeningReport, writeDocsGardeningArtifacts } from './docs-gardening-lib.mjs';

const repoRoot = process.cwd();
const report = buildDocsGardeningReport({ repoRoot });
const artifacts = writeDocsGardeningArtifacts(report, {
  repoRoot,
  outDir: path.join(repoRoot, 'tmp'),
});

console.log(
  [
    'docs gardening report written:',
    `- ${artifacts.jsonPath}`,
    `- ${artifacts.issueJsonPath}`,
    `- ${artifacts.issueMdPath}`,
    `- ${artifacts.healthJsonPath}`,
    `- ${artifacts.healthMdPath}`,
    `- ${artifacts.staleActiveJsonPath}`,
    `- ${artifacts.staleActiveMdPath}`,
  ].join('\n'),
);
