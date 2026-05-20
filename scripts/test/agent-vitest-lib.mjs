import path from 'node:path';

export function parsePackageTestScript({ scripts, scriptName }) {
  return parsePackageTestScriptInner({
    scripts,
    scriptName,
    delegateChain: [],
  });
}

export function buildAgentVitestSummary({ command, cwd, durationMs, json }) {
  const counts = {
    tests: {
      total: numberValue(json.numTotalTests),
      passed: numberValue(json.numPassedTests),
      failed: numberValue(json.numFailedTests),
      skipped: numberValue(json.numPendingTests) + numberValue(json.numTodoTests),
    },
    suites: {
      total: numberValue(json.numTotalTestSuites),
      passed: numberValue(json.numPassedTestSuites),
      failed: numberValue(json.numFailedTestSuites),
      skipped: numberValue(json.numPendingTestSuites),
    },
  };

  const failures = [];
  for (const testFile of Array.isArray(json.testResults) ? json.testResults : []) {
    const file = relativePath(cwd, testFile.name);
    for (const assertion of Array.isArray(testFile.assertionResults)
      ? testFile.assertionResults
      : []) {
      if (assertion.status !== 'failed') {
        continue;
      }
      failures.push({
        file,
        name: assertion.fullName || assertion.title || '(unnamed test)',
        message: compactFailureMessage(assertion.failureMessages),
      });
    }
  }

  return {
    status: json.success === true && failures.length === 0 ? 'pass' : 'fail',
    command,
    cwd,
    durationMs,
    counts,
    failures,
  };
}

export function buildAgentVitestLaneSummary({ label, durationMs, packages }) {
  const packageStatuses = new Map();
  for (const pkg of packages) {
    const previous = packageStatuses.get(pkg.packageName);
    packageStatuses.set(
      pkg.packageName,
      previous === 'fail' || pkg.status !== 'pass' ? 'fail' : 'pass',
    );
  }

  const counts = packages.reduce(
    (acc, pkg) => {
      const tests = pkg.summary?.counts?.tests;
      const suites = pkg.summary?.counts?.suites;
      acc.tests.total += tests?.total ?? 0;
      acc.tests.passed += tests?.passed ?? 0;
      acc.tests.failed += tests?.failed ?? 0;
      acc.tests.skipped += tests?.skipped ?? 0;
      acc.suites.total += suites?.total ?? 0;
      acc.suites.passed += suites?.passed ?? 0;
      acc.suites.failed += suites?.failed ?? 0;
      acc.suites.skipped += suites?.skipped ?? 0;
      return acc;
    },
    {
      packages: {
        total: packageStatuses.size,
        passed: [...packageStatuses.values()].filter((status) => status === 'pass').length,
        failed: [...packageStatuses.values()].filter((status) => status === 'fail').length,
      },
      tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
      suites: { total: 0, passed: 0, failed: 0, skipped: 0 },
    },
  );

  return {
    label,
    status: counts.packages.failed === 0 ? 'pass' : 'fail',
    durationMs,
    counts,
    packages,
  };
}

export function formatAgentVitestSummary(summary, { label, artifacts }) {
  const lines = [
    `vitest ${label} ${summary.status.toUpperCase()}  ${formatDuration(summary.durationMs)}`,
  ];

  if (summary.status === 'pass') {
    lines.push(
      `tests ${summary.counts.tests.passed} passed`,
      `suites ${summary.counts.suites.passed} passed`,
    );
  } else {
    lines.push(
      `failed ${summary.counts.tests.failed}/${summary.counts.tests.total} tests`,
      `suites ${summary.counts.suites.failed}/${summary.counts.suites.total} failed`,
      '',
      ...summary.failures.flatMap((failure, index) => [
        `${index + 1}. ${failure.file}`,
        `test: ${failure.name}`,
        'error:',
        indent(failure.message || '(no failure message)', '  '),
        '',
      ]),
      `repro: ${summary.command.join(' ')}`,
    );
  }

  lines.push(`raw log: ${artifacts.rawLog}`, `json: ${artifacts.json}`);
  return lines.join('\n');
}

export function formatAgentVitestLaneSummary(summary, { logsDir }) {
  const lines = [
    `vitest ${summary.label} ${summary.status.toUpperCase()}  ${formatDuration(summary.durationMs)}`,
  ];

  if (summary.status === 'pass') {
    lines.push(
      `packages ${summary.counts.packages.passed} passed`,
      `tests ${summary.counts.tests.passed} passed`,
      `suites ${summary.counts.suites.passed} passed`,
      `logs ${logsDir}`,
    );
    return lines.join('\n');
  }

  lines.push(
    `packages ${summary.counts.packages.failed}/${summary.counts.packages.total} failed`,
    `tests ${summary.counts.tests.failed}/${summary.counts.tests.total} failed`,
    `suites ${summary.counts.suites.failed}/${summary.counts.suites.total} failed`,
    '',
  );

  for (const pkg of summary.packages.filter((entry) => entry.status !== 'pass')) {
    lines.push(
      `${pkg.packageName} ${pkg.scriptName ?? ''} FAIL  ${formatDuration(pkg.durationMs)}`,
    );
    if (pkg.prepFailure) {
      lines.push('prep error:', indent(pkg.prepFailure.message, '  '));
    }
    for (const failure of pkg.summary?.failures ?? []) {
      lines.push(failure.file, `test: ${failure.name}`, 'error:', indent(failure.message, '  '));
    }
    if (pkg.repro) {
      lines.push(`repro: ${pkg.repro}`);
    }
    if (pkg.artifacts?.rawLog) {
      lines.push(`raw log: ${pkg.artifacts.rawLog}`);
    }
    if (pkg.artifacts?.prepLog) {
      lines.push(`prep log: ${pkg.artifacts.prepLog}`);
    }
    lines.push('');
  }

  lines.push(`logs ${logsDir}`);
  return lines.join('\n').trimEnd();
}

export function withAgentVitestArgs(args, outputFile) {
  const filtered = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--hideSkippedTests') {
      continue;
    }
    if (arg === '--reporter' || arg === '--outputFile' || arg === '--silent') {
      index += 1;
      continue;
    }
    if (
      arg.startsWith('--reporter=') ||
      arg.startsWith('--outputFile=') ||
      arg.startsWith('--silent=')
    ) {
      continue;
    }
    filtered.push(arg);
  }

  return [
    ...filtered,
    '--reporter=json',
    `--outputFile=${normalizePath(outputFile)}`,
    '--silent=passed-only',
    '--hideSkippedTests',
  ];
}

export function buildAgentVitestArtifacts({ repoRoot, lane, packageName, timestamp }) {
  const runDir = normalizePath(
    path.join(repoRoot, 'tmp', 'test-logs', `${timestamp}-${slug(lane)}`),
  );
  const packageDir = normalizePath(path.join(runDir, slug(packageName)));
  return {
    runDir,
    packageDir,
    rawLog: normalizePath(path.join(packageDir, 'raw.log')),
    prepLog: normalizePath(path.join(packageDir, 'prep.log')),
    json: normalizePath(path.join(packageDir, 'vitest.json')),
    summaryJson: normalizePath(path.join(runDir, 'summary.json')),
  };
}

function numberValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function parsePackageTestScriptInner({ scripts, scriptName, delegateChain }) {
  if (delegateChain.includes(scriptName)) {
    throw new Error(`Cyclic test script delegate: ${[...delegateChain, scriptName].join(' -> ')}`);
  }

  const script = scripts?.[scriptName];
  if (!script) {
    throw new Error(`Package script "${scriptName}" was not found.`);
  }

  const nextDelegateChain = [...delegateChain, scriptName];
  const segments = splitShellSegments(script);
  if (segments.length === 1) {
    const delegate = parsePnpmRunDelegate(segments[0]);
    if (delegate) {
      return parsePackageTestScriptInner({
        scripts,
        scriptName: delegate,
        delegateChain: nextDelegateChain,
      });
    }
  }

  const commandSegments = segments.map((segment) => commandFromSegment(segment));
  const vitestIndex = commandSegments.findIndex((command) => command.command === 'vitest');
  if (vitestIndex === -1) {
    throw new Error(`Package script "${scriptName}" does not contain a vitest command.`);
  }

  const vitestCommand = commandSegments[vitestIndex];
  return {
    scriptName,
    delegateChain: nextDelegateChain,
    prepCommands: commandSegments.slice(0, vitestIndex),
    vitestCommand,
  };
}

function parsePnpmRunDelegate(segment) {
  const tokens = tokenizeShell(segment);
  if (tokens.length < 3 || tokens[0] !== 'pnpm') {
    return null;
  }

  const runIndex = tokens.indexOf('run');
  if (runIndex === -1 || runIndex + 1 >= tokens.length) {
    return null;
  }

  const beforeRun = tokens.slice(1, runIndex);
  const afterTarget = tokens.slice(runIndex + 2);
  if (beforeRun.some((token) => token !== '--silent') || afterTarget.length > 0) {
    return null;
  }

  return tokens[runIndex + 1];
}

function splitShellSegments(script) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let index = 0; index < script.length; index += 1) {
    const char = script[index];
    if ((char === '"' || char === "'") && script[index - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
      current += char;
      continue;
    }
    if (!quote && char === '&' && script[index + 1] === '&') {
      segments.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    segments.push(current.trim());
  }
  return segments;
}

function commandFromSegment(segment) {
  const tokens = tokenizeShell(segment);
  if (tokens.length === 0) {
    throw new Error('Empty command segment.');
  }
  return {
    command: tokens[0],
    args: tokens.slice(1),
    display: tokens.join(' '),
  };
}

function tokenizeShell(value) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
      continue;
    }
    if (!quote && /\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function relativePath(cwd, filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return '(unknown file)';
  }
  const relative = path.relative(cwd, filePath);
  return normalizePath(relative && !relative.startsWith('..') ? relative : filePath);
}

function normalizePath(value) {
  return value.replaceAll(path.sep, '/').replaceAll('\\', '/');
}

function compactFailureMessage(messages) {
  const raw = Array.isArray(messages) ? messages.filter(Boolean).join('\n') : '';
  return raw
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line, index) => line.trim() || index < 4)
    .slice(0, 12)
    .join('\n')
    .trim();
}

function indent(value, prefix) {
  return value
    .split(/\r?\n/u)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) {
    return `${Math.max(0, Math.round(ms || 0))}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function slug(value) {
  return String(value)
    .replace(/^@/u, '')
    .replace(/[^a-zA-Z0-9_.-]+/gu, '-')
    .replace(/^-|-$/gu, '');
}
