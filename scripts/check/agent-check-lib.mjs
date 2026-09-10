import path from 'node:path';

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

export function buildAgentCheckArtifacts({ repoRoot, runLabel, lane, timestamp }) {
  const runDir = normalizePath(
    path.join(repoRoot, 'tmp', 'check-logs', `${timestamp}-${slug(runLabel)}`),
  );
  const laneDir = normalizePath(path.join(runDir, slug(lane)));
  return {
    runDir,
    laneDir,
    rawLog: normalizePath(path.join(laneDir, 'raw.log')),
    summaryJson: normalizePath(path.join(runDir, 'summary.json')),
  };
}

export function buildAgentCheckSummary({
  label,
  durationMs,
  lanes,
  ciRequirements = [],
  deferredBroadFallback = null,
}) {
  const problems = lanes.filter((lane) => lane.status !== 'pass');
  const firstFailure = lanes.find((lane) => lane.status === 'fail') ?? null;
  return {
    label,
    status:
      problems.length > 0
        ? 'fail'
        : ciRequirements.length > 0
          ? 'pass_with_ci_requirements'
          : 'pass',
    durationMs,
    counts: {
      total: lanes.length,
      passed: lanes.filter((lane) => lane.status === 'pass').length,
      failed: lanes.filter((lane) => lane.status === 'fail').length,
      blocked: lanes.filter((lane) => lane.status === 'blocked').length,
    },
    lanes,
    ciRequirements,
    deferredBroadFallback,
    problems,
    firstFailure,
  };
}

export function formatAgentCheckSummary(summary, { logsDir }) {
  const lines = [
    `${summary.label} ${summary.status.toUpperCase()}  ${formatDuration(summary.durationMs)}`,
  ];

  if (summary.status === 'pass') {
    lines.push(`lanes ${summary.counts.passed} passed`, `logs ${logsDir}`);
    return lines.join('\n');
  }

  if (summary.status === 'pass_with_ci_requirements') {
    if (summary.deferredBroadFallback) {
      lines.push(
        `broad local lanes not run: ${summary.deferredBroadFallback.lane} is delegated to hosted PR CI`,
        `reason: ${summary.deferredBroadFallback.reason}`,
      );
    }
    lines.push(
      summary.deferredBroadFallback
        ? `local lanes ${summary.counts.total} executed`
        : `local lanes ${summary.counts.passed} passed`,
      summary.deferredBroadFallback ? 'Hosted comprehensive regression required:' : 'CI required:',
      ...summary.ciRequirements.map(
        (requirement) => `  - ${requirement.id}: ${requirement.reason}`,
      ),
      `logs ${logsDir}`,
    );
    return lines.join('\n');
  }

  lines.push(
    `lanes ${summary.counts.failed} failed, ${summary.counts.blocked} blocked, ${summary.counts.passed} passed`,
  );
  for (const problem of summary.problems) {
    lines.push('', `lane ${problem.name} ${problem.status === 'blocked' ? 'blocked' : 'failed'}`);
    if (Number.isInteger(problem.exitCode)) {
      lines.push(`exit ${problem.exitCode}`);
    }
    lines.push('signal:', indent(problem.signal || '(no signal)', '  '));
    if (problem.repro) {
      lines.push(`repro: ${problem.repro}`);
    }
    if (problem.artifacts?.rawLog) {
      lines.push(`raw log: ${problem.artifacts.rawLog}`);
    }
  }
  lines.push('', `logs ${logsDir}`);
  return lines.join('\n');
}

export function compactSignal(output) {
  return output
    .replace(ansiEscapePattern, '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-16)
    .join('\n');
}

export function resolvePackageManagerCommand(args, env = process.env) {
  const npmExecPath = normalizeEnvValue(env.npmExecPath ?? env.npm_execpath);
  if (npmExecPath) {
    return {
      command: env.nodePath ?? process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: (env.platform ?? process.platform) === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
  };
}

export function buildSpawnInvocation(invocation, platform = process.platform) {
  if (platform !== 'win32' || invocation.command === process.execPath) {
    return invocation;
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', [invocation.command, ...invocation.args].map(quoteCmdArg).join(' ')],
  };
}

function normalizeEnvValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function quoteCmdArg(arg) {
  if (/^[a-zA-Z0-9_./:@%+=,\\-]+$/u.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/(["^&|<>])/gu, '^$1')}"`;
}

function normalizePath(value) {
  return value.replaceAll(path.sep, '/').replaceAll('\\', '/');
}

function slug(value) {
  return String(value)
    .replace(/^@/u, '')
    .replace(/[^a-zA-Z0-9_.-]+/gu, '-')
    .replace(/^-|-$/gu, '');
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
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}
