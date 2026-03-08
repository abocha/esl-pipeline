#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const generatedAt = new Date().toISOString();
const rootDir = process.cwd();
const timingsRoot = path.resolve('tmp/test-timings');
const vitestJsonPath = path.join(timingsRoot, 'frontend-unit-vitest.json');
const reportJsonPath = path.join(timingsRoot, 'frontend-unit-report.json');
const reportMdPath = path.join(timingsRoot, 'frontend-unit-report.md');

mkdirSync(timingsRoot, { recursive: true });

const emptyReport = {
  generatedAt,
  source: vitestJsonPath,
  summary: null,
  slowFiles: [],
  missingInput: true,
};

function toRelativePath(value) {
  if (!value) return value;
  if (value.startsWith(rootDir + path.sep)) {
    return value.slice(rootDir.length + 1);
  }
  return value;
}

if (!existsSync(vitestJsonPath)) {
  const lines = [
    '# Frontend Unit Timing Report (Non-Blocking)',
    '',
    `Generated at: ${generatedAt}`,
    '',
    `- Source JSON not found: ${vitestJsonPath}`,
  ];
  writeFileSync(reportJsonPath, JSON.stringify(emptyReport, null, 2));
  writeFileSync(reportMdPath, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  process.exit(0);
}

const raw = JSON.parse(readFileSync(vitestJsonPath, 'utf8'));
const suites = Array.isArray(raw.testResults) ? raw.testResults : [];

const slowFiles = suites
  .map((suite) => {
    const name = toRelativePath(suite.name);
    const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
    const durationMs =
      Number.isFinite(suite.startTime) && Number.isFinite(suite.endTime)
        ? Math.max(0, suite.endTime - suite.startTime)
        : assertions.reduce((sum, assertion) => sum + (Number(assertion.duration) || 0), 0);

    return {
      file: name,
      status: suite.status ?? 'unknown',
      durationMs: Number(durationMs.toFixed(2)),
      testCount: assertions.length,
    };
  })
  .sort((left, right) => right.durationMs - left.durationMs);

const totalDurationMs = Number(
  slowFiles.reduce((sum, entry) => sum + entry.durationMs, 0).toFixed(2),
);

const summary = {
  totalSuites: Number(raw.numTotalTestSuites ?? suites.length),
  passedSuites: Number(raw.numPassedTestSuites ?? 0),
  failedSuites: Number(raw.numFailedTestSuites ?? 0),
  totalTests: Number(raw.numTotalTests ?? 0),
  passedTests: Number(raw.numPassedTests ?? 0),
  failedTests: Number(raw.numFailedTests ?? 0),
  totalDurationMs,
  longestFileMs: slowFiles[0]?.durationMs ?? 0,
  filesOver10s: slowFiles.filter((entry) => entry.durationMs >= 10_000).length,
};

const report = {
  generatedAt,
  source: vitestJsonPath,
  summary,
  slowFiles: slowFiles.slice(0, 20),
  missingInput: false,
};

const lines = [];
lines.push('# Frontend Unit Timing Report (Non-Blocking)');
lines.push('');
lines.push(`Generated at: ${generatedAt}`);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(`- Suites: ${summary.passedSuites}/${summary.totalSuites} passed`);
lines.push(`- Tests: ${summary.passedTests}/${summary.totalTests} passed`);
lines.push(`- Aggregate file duration: ${summary.totalDurationMs}ms`);
lines.push(`- Longest file duration: ${summary.longestFileMs}ms`);
lines.push(`- Files >= 10s: ${summary.filesOver10s}`);
lines.push('');

if (report.slowFiles.length > 0) {
  lines.push('## Slowest Files');
  lines.push('');
  lines.push('| File | Duration (ms) | Tests | Status |');
  lines.push('| --- | ---: | ---: | --- |');
  for (const entry of report.slowFiles) {
    lines.push(`| ${entry.file} | ${entry.durationMs} | ${entry.testCount} | ${entry.status} |`);
  }
  lines.push('');
}

writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
writeFileSync(reportMdPath, `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
