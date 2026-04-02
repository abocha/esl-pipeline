#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const generatedAt = new Date().toISOString();
const rootDir = process.cwd();
const timingsRoot = path.resolve('tmp/test-timings');
const reportJsonPath = path.join(timingsRoot, 'unit-report.json');
const reportMdPath = path.join(timingsRoot, 'unit-report.md');
const packages = [
  {
    key: 'batch-backend',
    label: '@esl-pipeline/batch-backend',
  },
  {
    key: 'batch-frontend',
    label: '@esl-pipeline/batch-frontend',
  },
  {
    key: 'orchestrator',
    label: '@esl-pipeline/orchestrator',
  },
  {
    key: 'telegram-ops-bot',
    label: '@esl-pipeline/telegram-ops-bot',
  },
  {
    key: 'tts-provider-elevenlabs',
    label: '@esl-pipeline/tts-provider-elevenlabs',
  },
  {
    key: 'html-publisher',
    label: '@esl-pipeline/html-publisher',
  },
];

mkdirSync(timingsRoot, { recursive: true });

function toRelativePath(value) {
  if (!value) return value;
  if (value.startsWith(rootDir + path.sep)) {
    return value.slice(rootDir.length + 1);
  }
  return value;
}

function toNumber(value) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function parsePackageReport(pkg) {
  const vitestJsonPath = path.join(timingsRoot, pkg.key, 'vitest.json');
  if (!existsSync(vitestJsonPath)) {
    return {
      key: pkg.key,
      label: pkg.label,
      source: vitestJsonPath,
      summary: {
        totalSuites: 0,
        passedSuites: 0,
        failedSuites: 0,
        pendingSuites: 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        pendingTests: 0,
        todoTests: 0,
        totalDurationMs: 0,
        longestFileMs: 0,
        filesOver10s: 0,
      },
      slowFiles: [],
      missingInput: true,
    };
  }

  const raw = JSON.parse(readFileSync(vitestJsonPath, 'utf8'));
  const files = Array.isArray(raw.testResults) ? raw.testResults : [];
  const slowFiles = files
    .map((file) => {
      const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
      const durationMs =
        Number.isFinite(file.startTime) && Number.isFinite(file.endTime)
          ? Math.max(0, file.endTime - file.startTime)
          : assertions.reduce((sum, assertion) => sum + (Number(assertion.duration) || 0), 0);

      return {
        file: toRelativePath(file.name),
        status: file.status ?? 'unknown',
        durationMs: Number(durationMs.toFixed(2)),
        testCount: assertions.length,
      };
    })
    .sort((left, right) => right.durationMs - left.durationMs);

  const totalDurationMs = Number(
    slowFiles.reduce((sum, entry) => sum + entry.durationMs, 0).toFixed(2),
  );

  return {
    key: pkg.key,
    label: pkg.label,
    source: vitestJsonPath,
    summary: {
      totalSuites: toNumber(raw.numTotalTestSuites ?? files.length),
      passedSuites: toNumber(raw.numPassedTestSuites),
      failedSuites: toNumber(raw.numFailedTestSuites),
      pendingSuites: toNumber(raw.numPendingTestSuites),
      totalTests: toNumber(raw.numTotalTests),
      passedTests: toNumber(raw.numPassedTests),
      failedTests: toNumber(raw.numFailedTests),
      pendingTests: toNumber(raw.numPendingTests),
      todoTests: toNumber(raw.numTodoTests),
      totalDurationMs,
      longestFileMs: slowFiles[0]?.durationMs ?? 0,
      filesOver10s: slowFiles.filter((entry) => entry.durationMs >= 10_000).length,
    },
    slowFiles,
    missingInput: false,
  };
}

const packageReports = packages.map(parsePackageReport);
const allSlowFiles = packageReports
  .flatMap((pkg) =>
    pkg.slowFiles.map((entry) => ({
      packageKey: pkg.key,
      packageLabel: pkg.label,
      ...entry,
    })),
  )
  .sort((left, right) => right.durationMs - left.durationMs);

const overallSummary = packageReports.reduce(
  (acc, pkg) => {
    acc.packagesTotal += 1;
    if (pkg.missingInput) {
      acc.packagesMissing += 1;
    } else {
      acc.packagesWithInput += 1;
    }

    acc.totalSuites += pkg.summary.totalSuites;
    acc.passedSuites += pkg.summary.passedSuites;
    acc.failedSuites += pkg.summary.failedSuites;
    acc.pendingSuites += pkg.summary.pendingSuites;
    acc.totalTests += pkg.summary.totalTests;
    acc.passedTests += pkg.summary.passedTests;
    acc.failedTests += pkg.summary.failedTests;
    acc.pendingTests += pkg.summary.pendingTests;
    acc.todoTests += pkg.summary.todoTests;
    acc.totalDurationMs += pkg.summary.totalDurationMs;
    acc.filesOver10s += pkg.summary.filesOver10s;

    return acc;
  },
  {
    packagesTotal: 0,
    packagesWithInput: 0,
    packagesMissing: 0,
    totalSuites: 0,
    passedSuites: 0,
    failedSuites: 0,
    pendingSuites: 0,
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    pendingTests: 0,
    todoTests: 0,
    totalDurationMs: 0,
    filesOver10s: 0,
  },
);

overallSummary.totalDurationMs = Number(overallSummary.totalDurationMs.toFixed(2));

const report = {
  generatedAt,
  source: packages.map((pkg) => path.join(timingsRoot, pkg.key, 'vitest.json')),
  summary: {
    ...overallSummary,
    longestFileMs: allSlowFiles[0]?.durationMs ?? 0,
  },
  packages: packageReports.map((pkg) => ({
    key: pkg.key,
    label: pkg.label,
    source: pkg.source,
    summary: pkg.summary,
    slowFiles: pkg.slowFiles.slice(0, 10),
    missingInput: pkg.missingInput,
  })),
  slowFiles: allSlowFiles.slice(0, 20),
};

const lines = [];
lines.push('# Unit Timing Report (Non-Blocking)');
lines.push('');
lines.push(`Generated at: ${generatedAt}`);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(
  `- Packages with input: ${overallSummary.packagesWithInput}/${overallSummary.packagesTotal}`,
);
lines.push(`- Suites: ${overallSummary.passedSuites}/${overallSummary.totalSuites} passed`);
lines.push(`- Tests: ${overallSummary.passedTests}/${overallSummary.totalTests} passed`);
lines.push(`- Aggregate file duration: ${overallSummary.totalDurationMs}ms`);
lines.push(`- Longest file duration: ${report.summary.longestFileMs}ms`);
lines.push(`- Files >= 10s: ${overallSummary.filesOver10s}`);
lines.push('');

lines.push('## Package Summaries');
lines.push('');
lines.push(
  '| Package | Suites | Tests | Duration (ms) | Longest File (ms) | Files >= 10s | Status |',
);
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
for (const pkg of report.packages) {
  const status = pkg.missingInput ? 'missing input' : 'ok';
  lines.push(
    `| ${pkg.label} | ${pkg.summary.passedSuites}/${pkg.summary.totalSuites} | ${pkg.summary.passedTests}/${pkg.summary.totalTests} | ${pkg.summary.totalDurationMs} | ${pkg.summary.longestFileMs} | ${pkg.summary.filesOver10s} | ${status} |`,
  );
}
lines.push('');

if (report.slowFiles.length > 0) {
  lines.push('## Slowest Files Overall');
  lines.push('');
  lines.push('| File | Package | Duration (ms) | Tests | Status |');
  lines.push('| --- | --- | ---: | ---: | --- |');
  for (const entry of report.slowFiles) {
    lines.push(
      `| ${entry.file} | ${entry.packageLabel} | ${entry.durationMs} | ${entry.testCount} | ${entry.status} |`,
    );
  }
  lines.push('');
}

lines.push('## Slowest Files by Package');
lines.push('');
for (const pkg of report.packages) {
  lines.push(`### ${pkg.label}`);
  lines.push('');
  if (pkg.missingInput) {
    lines.push(`- Source JSON not found: ${pkg.source}`);
    lines.push('');
    continue;
  }
  if (pkg.slowFiles.length === 0) {
    lines.push('- No test files found.');
    lines.push('');
    continue;
  }
  lines.push('| File | Duration (ms) | Tests | Status |');
  lines.push('| --- | ---: | ---: | --- |');
  for (const entry of pkg.slowFiles.slice(0, 10)) {
    lines.push(`| ${entry.file} | ${entry.durationMs} | ${entry.testCount} | ${entry.status} |`);
  }
  lines.push('');
}

writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
writeFileSync(reportMdPath, `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
