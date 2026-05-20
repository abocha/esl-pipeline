import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  buildAgentVitestArtifacts,
  buildAgentVitestLaneSummary,
  buildAgentVitestSummary,
  formatAgentVitestLaneSummary,
  formatAgentVitestSummary,
  parsePackageTestScript,
  withAgentVitestArgs,
} from './agent-vitest-lib.mjs';

test('agent vitest summary reports a passing run without listing passed test files', () => {
  const result = buildAgentVitestSummary({
    command: ['vitest', 'run'],
    cwd: 'D:/code/esl-pipeline',
    durationMs: 1250,
    json: {
      success: true,
      numTotalTestSuites: 2,
      numPassedTestSuites: 2,
      numFailedTestSuites: 0,
      numTotalTests: 9,
      numPassedTests: 9,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          name: 'D:/code/esl-pipeline/packages/html-publisher/tests/rendering.test.ts',
          status: 'passed',
          assertionResults: [
            {
              fullName: 'rendering emits accessible markup',
              status: 'passed',
              failureMessages: [],
            },
          ],
        },
      ],
    },
  });

  assert.equal(result.status, 'pass');
  assert.equal(result.counts.tests.total, 9);
  assert.deepEqual(result.failures, []);

  const text = formatAgentVitestSummary(result, {
    label: 'html-publisher',
    artifacts: {
      rawLog: path.join('tmp', 'test-logs', 'html-publisher.log'),
      json: path.join('tmp', 'test-logs', 'html-publisher.json'),
    },
  });

  assert.match(text, /vitest html-publisher PASS/);
  assert.match(text, /tests 9 passed/);
  assert.match(text, /suites 2 passed/);
  assert.doesNotMatch(text, /rendering\.test\.ts/);
  assert.doesNotMatch(text, /emits accessible markup/);
});

test('agent vitest summary reports only failed assertions and reproduction command', () => {
  const result = buildAgentVitestSummary({
    command: ['vitest', 'run', 'packages/example/tests/example.test.ts'],
    cwd: 'D:/code/esl-pipeline',
    durationMs: 2310,
    json: {
      success: false,
      numTotalTestSuites: 2,
      numPassedTestSuites: 1,
      numFailedTestSuites: 1,
      numTotalTests: 4,
      numPassedTests: 3,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          name: 'D:/code/esl-pipeline/packages/example/tests/example.test.ts',
          status: 'failed',
          message: 'suite failed',
          assertionResults: [
            {
              fullName: 'example rejects empty input',
              status: 'failed',
              failureMessages: [
                [
                  'AssertionError: expected false to be true',
                  ' ❯ packages/example/tests/example.test.ts:12:20',
                  '',
                  'very noisy passing context that should not matter',
                ].join('\n'),
              ],
            },
            {
              fullName: 'example accepts valid input',
              status: 'passed',
              failureMessages: [],
            },
          ],
        },
      ],
    },
  });

  assert.equal(result.status, 'fail');
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].file, 'packages/example/tests/example.test.ts');
  assert.equal(result.failures[0].name, 'example rejects empty input');
  assert.match(result.failures[0].message, /expected false to be true/);

  const text = formatAgentVitestSummary(result, {
    label: 'example',
    artifacts: {
      rawLog: path.join('tmp', 'test-logs', 'example.log'),
      json: path.join('tmp', 'test-logs', 'example.json'),
    },
  });

  assert.match(text, /vitest example FAIL/);
  assert.match(text, /failed 1\/4/);
  assert.match(text, /packages\/example\/tests\/example\.test\.ts/);
  assert.match(text, /example rejects empty input/);
  assert.match(text, /expected false to be true/);
  assert.match(text, /repro: vitest run packages\/example\/tests\/example\.test\.ts/);
  assert.doesNotMatch(text, /example accepts valid input/);
});

test('agent vitest args replace only output controls', () => {
  const args = withAgentVitestArgs(
    [
      'run',
      '--config',
      '../../vitest.config.ts',
      '--reporter=dot',
      '--outputFile=old.json',
      '--silent=false',
      '--hideSkippedTests',
      '--maxWorkers=1',
      'tests/example.test.ts',
    ],
    'tmp/test-logs/example/vitest.json',
  );

  assert.deepEqual(args, [
    'run',
    '--config',
    '../../vitest.config.ts',
    '--maxWorkers=1',
    'tests/example.test.ts',
    '--reporter=json',
    '--outputFile=tmp/test-logs/example/vitest.json',
    '--silent=passed-only',
    '--hideSkippedTests',
  ]);
});

test('package test script parser supports direct vitest scripts', () => {
  const parsed = parsePackageTestScript({
    scripts: {
      'test:unit:prebuilt':
        'vitest run --config ../../vitest.config.ts --dir ../../packages/provider-runtime/tests --reporter=dot --exclude "**/*.integration.test.ts"',
    },
    scriptName: 'test:unit:prebuilt',
  });

  assert.deepEqual(parsed.prepCommands, []);
  assert.equal(parsed.vitestCommand.command, 'vitest');
  assert.deepEqual(parsed.vitestCommand.args, [
    'run',
    '--config',
    '../../vitest.config.ts',
    '--dir',
    '../../packages/provider-runtime/tests',
    '--reporter=dot',
    '--exclude',
    '**/*.integration.test.ts',
  ]);
});

test('package test script parser supports setup followed by vitest', () => {
  const parsed = parsePackageTestScript({
    scripts: {
      'test:unit': 'pnpm run test:unit:setup && vitest run --testTimeout=150000',
      'test:unit:setup': 'pnpm --filter @esl-pipeline/contracts build',
    },
    scriptName: 'test:unit',
  });

  assert.equal(parsed.prepCommands.length, 1);
  assert.equal(parsed.prepCommands[0].command, 'pnpm');
  assert.deepEqual(parsed.prepCommands[0].args, ['run', 'test:unit:setup']);
  assert.equal(parsed.vitestCommand.command, 'vitest');
  assert.deepEqual(parsed.vitestCommand.args, ['run', '--testTimeout=150000']);
});

test('package test script parser supports one-hop local delegates', () => {
  const parsed = parsePackageTestScript({
    scripts: {
      'test:integration': 'pnpm run test:integration:http',
      'test:integration:http':
        'vitest run --config ../../vitest.config.ts --reporter=dot tests/http.integration.test.ts',
    },
    scriptName: 'test:integration',
  });

  assert.equal(parsed.scriptName, 'test:integration:http');
  assert.deepEqual(parsed.delegateChain, ['test:integration', 'test:integration:http']);
  assert.equal(parsed.vitestCommand.command, 'vitest');
  assert.deepEqual(parsed.vitestCommand.args, [
    'run',
    '--config',
    '../../vitest.config.ts',
    '--reporter=dot',
    'tests/http.integration.test.ts',
  ]);
});

test('agent vitest lane summary reports aggregate pass without package chatter', () => {
  const lane = buildAgentVitestLaneSummary({
    label: 'unit-prebuilt',
    durationMs: 92_000,
    packages: [
      packagePass('@esl-pipeline/html-publisher', 62, 12),
      packagePass('@esl-pipeline/provider-runtime', 18, 3),
    ],
  });

  assert.equal(lane.status, 'pass');
  assert.equal(lane.counts.packages.passed, 2);
  assert.equal(lane.counts.tests.passed, 80);

  const text = formatAgentVitestLaneSummary(lane, {
    logsDir: 'tmp/test-logs/2026-unit-prebuilt',
  });

  assert.match(text, /vitest unit-prebuilt PASS/);
  assert.match(text, /packages 2 passed/);
  assert.match(text, /tests 80 passed/);
  assert.doesNotMatch(text, /html-publisher PASS/);
  assert.doesNotMatch(text, /provider-runtime PASS/);
});

test('agent vitest lane summary reports only failed package details', () => {
  const failingPackage = packageFail('@esl-pipeline/batch-backend', {
    file: 'packages/batch-backend/tests/example.test.ts',
    name: 'example stores state',
    message: 'Expected true\nReceived false',
  });
  const lane = buildAgentVitestLaneSummary({
    label: 'unit-prebuilt',
    durationMs: 31_000,
    packages: [packagePass('@esl-pipeline/html-publisher', 62, 12), failingPackage],
  });

  const text = formatAgentVitestLaneSummary(lane, {
    logsDir: 'tmp/test-logs/2026-unit-prebuilt',
  });

  assert.match(text, /vitest unit-prebuilt FAIL/);
  assert.match(text, /packages 1\/2 failed/);
  assert.match(text, /@esl-pipeline\/batch-backend/);
  assert.match(text, /example stores state/);
  assert.match(text, /Expected true/);
  assert.doesNotMatch(text, /@esl-pipeline\/html-publisher PASS/);
});

test('agent vitest artifact paths are lane scoped and sanitized', () => {
  const artifacts = buildAgentVitestArtifacts({
    repoRoot: 'D:/code/esl-pipeline',
    lane: 'unit:prebuilt/fast',
    packageName: '@esl-pipeline/batch-backend',
    timestamp: '2026-05-20T14-30-00-000Z',
  });

  assert.equal(
    artifacts.runDir,
    'D:/code/esl-pipeline/tmp/test-logs/2026-05-20T14-30-00-000Z-unit-prebuilt-fast',
  );
  assert.equal(
    artifacts.packageDir,
    'D:/code/esl-pipeline/tmp/test-logs/2026-05-20T14-30-00-000Z-unit-prebuilt-fast/esl-pipeline-batch-backend',
  );
  assert.equal(artifacts.rawLog.endsWith('/raw.log'), true);
  assert.equal(artifacts.json.endsWith('/vitest.json'), true);
  assert.equal(artifacts.summaryJson.endsWith('/summary.json'), true);
});

function packagePass(packageName, tests, suites) {
  return {
    packageName,
    status: 'pass',
    exitCode: 0,
    durationMs: 1000,
    artifacts: {
      rawLog: `tmp/test-logs/${packageName}/raw.log`,
      json: `tmp/test-logs/${packageName}/vitest.json`,
    },
    summary: buildAgentVitestSummary({
      command: ['vitest', 'run'],
      cwd: 'D:/code/esl-pipeline',
      durationMs: 1000,
      json: {
        success: true,
        numTotalTestSuites: suites,
        numPassedTestSuites: suites,
        numFailedTestSuites: 0,
        numPendingTestSuites: 0,
        numTotalTests: tests,
        numPassedTests: tests,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        testResults: [],
      },
    }),
  };
}

function packageFail(packageName, failure) {
  return {
    packageName,
    status: 'fail',
    exitCode: 1,
    durationMs: 1000,
    artifacts: {
      rawLog: `tmp/test-logs/${packageName}/raw.log`,
      json: `tmp/test-logs/${packageName}/vitest.json`,
    },
    summary: {
      status: 'fail',
      durationMs: 1000,
      command: ['vitest', 'run', failure.file],
      counts: {
        tests: { total: 2, passed: 1, failed: 1, skipped: 0 },
        suites: { total: 1, passed: 0, failed: 1, skipped: 0 },
      },
      failures: [failure],
    },
  };
}
