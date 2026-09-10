import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentCheckArtifacts,
  buildAgentCheckSummary,
  formatAgentCheckSummary,
  resolvePackageManagerCommand,
} from './agent-check-lib.mjs';

test('agent check summary reports a passing run without captured lane output', () => {
  const summary = buildAgentCheckSummary({
    label: 'check:fast:agent',
    durationMs: 12_500,
    lanes: [
      lanePass('guard-orchestrator-boundary'),
      lanePass('release-verify-contracts'),
      lanePass('build'),
    ],
  });

  assert.equal(summary.status, 'pass');
  assert.equal(summary.counts.passed, 3);

  const text = formatAgentCheckSummary(summary, {
    logsDir: 'tmp/check-logs/2026-check-fast',
  });

  assert.match(text, /check:fast:agent PASS/);
  assert.match(text, /lanes 3 passed/);
  assert.doesNotMatch(text, /noisy build output/);
  assert.doesNotMatch(text, /guard-orchestrator-boundary PASS/);
});

test('agent check summary reports passing local evidence with required CI evidence', () => {
  const ciRequirements = [
    {
      id: 'backend-db-integration',
      reason: 'backend worker or queue behavior changed',
    },
  ];
  const summary = buildAgentCheckSummary({
    label: 'check:fast:agent',
    durationMs: 12_500,
    lanes: [lanePass('test:check-routing'), lanePass('turbo:test:unit:prebuilt')],
    ciRequirements,
  });

  assert.equal(summary.status, 'pass_with_ci_requirements');
  assert.deepEqual(summary.ciRequirements, ciRequirements);

  const text = formatAgentCheckSummary(summary, {
    logsDir: 'tmp/check-logs/2026-check-fast',
  });

  assert.match(text, /check:fast:agent PASS_WITH_CI_REQUIREMENTS/u);
  assert.match(text, /local lanes 2 passed/u);
  assert.match(
    text,
    /CI required:\n {2}- backend-db-integration: backend worker or queue behavior changed/u,
  );
});

test('deferred broad fallback remains ready for hosted CI without claiming local broad evidence', () => {
  const summary = buildAgentCheckSummary({
    label: 'check:fast:agent',
    durationMs: 500,
    lanes: [],
    ciRequirements: [
      {
        id: 'backend-db-integration',
        reason: 'changed scope requires conservative hosted service evidence',
      },
      {
        id: 'CI gate',
        reason:
          'affected routing requires conservative broad validation; hosted PR CI owns comprehensive regression',
      },
    ],
    deferredBroadFallback: {
      lane: 'check:pre-pr',
      reason:
        'root validation, package manager, TypeScript, Vitest, Biome, or Turbo config changed',
    },
  });

  assert.equal(summary.status, 'pass_with_ci_requirements');
  assert.deepEqual(summary.counts, { total: 0, passed: 0, failed: 0, blocked: 0 });

  const text = formatAgentCheckSummary(summary, {
    logsDir: 'tmp/check-logs/2026-check-fast',
  });

  assert.match(text, /PASS_WITH_CI_REQUIREMENTS/u);
  assert.match(text, /broad local lanes not run: check:pre-pr is delegated to hosted PR CI/u);
  assert.match(text, /local lanes 0 executed/u);
  assert.match(text, /Hosted comprehensive regression required:/u);
  assert.doesNotMatch(text, /local lanes [1-9][0-9]* passed/u);
});

test('local failures remain failures when CI evidence is also required', () => {
  const summary = buildAgentCheckSummary({
    label: 'check:fast:agent',
    durationMs: 1000,
    lanes: [
      {
        ...lanePass('lint'),
        status: 'fail',
        exitCode: 1,
      },
    ],
    ciRequirements: [
      {
        id: 'backend-db-integration',
        reason: 'backend repository behavior changed',
      },
    ],
  });

  assert.equal(summary.status, 'fail');
});

test('agent check summary aggregates every failed and blocked lane', () => {
  const summary = buildAgentCheckSummary({
    label: 'check:fast:agent',
    durationMs: 30_000,
    lanes: [
      lanePass('guard-orchestrator-boundary'),
      {
        name: 'build',
        status: 'fail',
        exitCode: 1,
        durationMs: 2000,
        signal: 'TS2741: Property applicationName is missing',
        repro: 'pnpm build',
        artifacts: {
          rawLog: 'tmp/check-logs/2026-check-fast/build/raw.log',
        },
      },
      {
        name: 'test:unit:prebuilt',
        status: 'blocked',
        exitCode: null,
        durationMs: 0,
        signal: 'blocked by failed prerequisite: build',
        blockedBy: ['build'],
        repro: 'pnpm test:unit:prebuilt',
        artifacts: {},
      },
      {
        name: 'lint',
        status: 'fail',
        exitCode: 1,
        durationMs: 1000,
        signal: 'this must not appear',
        repro: 'pnpm lint',
        artifacts: {
          rawLog: 'tmp/check-logs/2026-check-fast/lint/raw.log',
        },
      },
      lanePass('typecheck'),
    ],
  });

  assert.equal(summary.status, 'fail');
  assert.deepEqual(summary.counts, {
    total: 5,
    passed: 2,
    failed: 2,
    blocked: 1,
  });
  assert.deepEqual(
    summary.problems.map((lane) => [lane.name, lane.status]),
    [
      ['build', 'fail'],
      ['test:unit:prebuilt', 'blocked'],
      ['lint', 'fail'],
    ],
  );

  const text = formatAgentCheckSummary(summary, {
    logsDir: 'tmp/check-logs/2026-check-fast',
  });

  assert.match(text, /check:fast:agent FAIL/);
  assert.match(text, /lane build failed/);
  assert.match(text, /exit 1/);
  assert.match(text, /TS2741/);
  assert.match(text, /repro: pnpm build/);
  assert.match(text, /raw log: tmp\/check-logs\/2026-check-fast\/build\/raw\.log/);
  assert.match(text, /lane test:unit:prebuilt blocked/);
  assert.match(text, /blocked by failed prerequisite: build/);
  assert.match(text, /lane lint failed/);
  assert.match(text, /this must not appear/);
});

test('agent check artifact paths are lane scoped and sanitized', () => {
  const artifacts = buildAgentCheckArtifacts({
    repoRoot: 'D:/code/esl-pipeline',
    runLabel: 'check:fast',
    lane: 'release:verify/contracts',
    timestamp: '2026-05-20T15-00-00-000Z',
  });

  assert.equal(
    artifacts.runDir,
    'D:/code/esl-pipeline/tmp/check-logs/2026-05-20T15-00-00-000Z-check-fast',
  );
  assert.equal(
    artifacts.laneDir,
    'D:/code/esl-pipeline/tmp/check-logs/2026-05-20T15-00-00-000Z-check-fast/release-verify-contracts',
  );
  assert.equal(artifacts.rawLog.endsWith('/raw.log'), true);
  assert.equal(artifacts.summaryJson.endsWith('/summary.json'), true);
});

test('package manager command resolution uses npm_execpath with node on Windows-capable shells', () => {
  const resolved = resolvePackageManagerCommand(['build'], {
    npmExecPath: 'C:/Users/abocha/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs',
    nodePath: 'C:/Program Files/nodejs/node.exe',
    platform: 'win32',
  });

  assert.equal(resolved.command, 'C:/Program Files/nodejs/node.exe');
  assert.deepEqual(resolved.args, [
    'C:/Users/abocha/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs',
    'build',
  ]);
});

function lanePass(name) {
  return {
    name,
    status: 'pass',
    exitCode: 0,
    durationMs: 1000,
    signal: 'noisy build output',
    repro: `pnpm ${name}`,
    artifacts: {
      rawLog: `tmp/check-logs/2026-check-fast/${name}/raw.log`,
    },
  };
}
