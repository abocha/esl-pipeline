#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { loadDocsCheckConfig, runDocsChecks } from './docs-check-lib.mjs';

const repoRoot = process.cwd();
const now = new Date().toISOString();
const config = loadDocsCheckConfig(repoRoot);

const core = runDocsChecks('core', { repoRoot, config });
const ops = runDocsChecks('ops', { repoRoot, config });
const nonCore = runDocsChecks('non_core', { repoRoot, config });

const checks = {
  core,
  ops,
  non_core: nonCore,
};

const metrics = {
  checkedDocs: core.docsChecked + ops.docsChecked + nonCore.docsChecked,
  errors: core.errors.length + ops.errors.length + nonCore.errors.length,
  warnings: core.warnings.length + ops.warnings.length + nonCore.warnings.length,
};

const scoring = buildScorecard({ core, ops, nonCore, metrics });

const report = {
  generatedAt: now,
  metrics,
  checks,
  scoring,
};

const outDir = path.join(repoRoot, 'tmp');
fs.mkdirSync(outDir, { recursive: true });

const jsonPath = path.join(outDir, 'docs-health-report.json');
const mdPath = path.join(outDir, 'docs-health-report.md');

fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(mdPath, toMarkdown(report), 'utf8');

console.log(`docs health report written:\n- ${jsonPath}\n- ${mdPath}`);

function buildScorecard({ core, ops, nonCore, metrics }) {
  const routingPenalty = countMatches(core.errors, ['missing-route-hint', 'missing-route-doc']);
  const allErrors = [...core.errors, ...ops.errors, ...nonCore.errors];
  const authorityPenalty = countMatches(allErrors, ['missing-meta']);
  const freshnessPenalty = countMatches(allErrors, ['stale-doc', 'missing-freshness', 'invalid-freshness']);
  const enforcePenalty = metrics.errors;
  const opsPenalty = ops.errors.length + nonCore.errors.length;

  const routingClarity = clampScore(10 - routingPenalty * 1.5);
  const authorityClarity = clampScore(10 - authorityPenalty * 0.8);
  const freshness = clampScore(10 - freshnessPenalty * 1.2);
  const mechanical = clampScore(10 - enforcePenalty * 0.3);
  const opsReliability = clampScore(10 - opsPenalty * 0.7);
  const archiveHygiene = 8.8;
  const onboarding = clampScore((routingClarity + authorityClarity + freshness) / 3);

  const dimensions = {
    routing_clarity: routingClarity,
    authority_ownership_clarity: authorityClarity,
    freshness_drift_resistance: freshness,
    mechanical_enforceability: mechanical,
    ops_runbook_reliability: opsReliability,
    archive_hygiene: archiveHygiene,
    agent_onboarding_speed: onboarding,
  };

  const values = Object.values(dimensions);
  const composite = Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(2));

  return {
    dimensions,
    composite,
  };
}

function countMatches(lines, patterns) {
  return lines.filter((line) => patterns.some((pattern) => line.includes(pattern))).length;
}

function clampScore(value) {
  if (value < 0) return 0;
  if (value > 10) return 10;
  return Number(value.toFixed(2));
}

function toMarkdown(report) {
  const { generatedAt, metrics, checks, scoring } = report;
  const lines = [];

  lines.push('# Docs Health Report');
  lines.push('');
  lines.push(`- Generated at: ${generatedAt}`);
  lines.push(`- Checked docs: ${metrics.checkedDocs}`);
  lines.push(`- Errors: ${metrics.errors}`);
  lines.push(`- Warnings: ${metrics.warnings}`);
  lines.push('');
  lines.push('## Scorecard');
  lines.push('');
  lines.push('| Dimension | Score |');
  lines.push('| --- | --- |');

  for (const [dimension, score] of Object.entries(scoring.dimensions)) {
    lines.push(`| ${dimension} | ${score} |`);
  }

  lines.push(`| composite | ${scoring.composite} |`);
  lines.push('');

  lines.push('## Core Check');
  lines.push('');
  lines.push(`- Docs checked: ${checks.core.docsChecked}`);
  lines.push(`- Errors: ${checks.core.errors.length}`);
  lines.push(`- Warnings: ${checks.core.warnings.length}`);
  lines.push('');
  appendList(lines, checks.core.errors, 'Core errors');
  appendList(lines, checks.core.warnings, 'Core warnings');

  lines.push('## Ops Check');
  lines.push('');
  lines.push(`- Docs checked: ${checks.ops.docsChecked}`);
  lines.push(`- Errors: ${checks.ops.errors.length}`);
  lines.push(`- Warnings: ${checks.ops.warnings.length}`);
  lines.push('');
  appendList(lines, checks.ops.errors, 'Ops errors');
  appendList(lines, checks.ops.warnings, 'Ops warnings');

  lines.push('## Non-Core Check');
  lines.push('');
  lines.push(`- Docs checked: ${checks.non_core.docsChecked}`);
  lines.push(`- Errors: ${checks.non_core.errors.length}`);
  lines.push(`- Warnings: ${checks.non_core.warnings.length}`);
  lines.push('');
  appendList(lines, checks.non_core.errors, 'Non-core errors');
  appendList(lines, checks.non_core.warnings, 'Non-core warnings');

  return `${lines.join('\n')}\n`;
}

function appendList(lines, items, title) {
  lines.push(`### ${title}`);
  lines.push('');
  if (items.length === 0) {
    lines.push('- none');
    lines.push('');
    return;
  }

  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push('');
}
