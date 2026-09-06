import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentCheckArtifacts,
  buildAgentCheckSummary,
  compactSignal,
  formatAgentCheckSummary,
} from './agent-check-lib.mjs';
import {
  buildFullCheckEvidence,
  buildFullCheckLaneResult,
  buildFullCheckLanes,
  runFullCheckLanes,
} from './full-check-lib.mjs';

const canonicalScripts = [
  'test:tooling',
  'build',
  'typecheck',
  'lint',
  'test:unit:prebuilt',
  'test:integration:prebuilt',
  'test:backend:db:worker',
];

test('full check exposes one ordered topology of canonical root scripts', () => {
  const lanes = buildFullCheckLanes();

  assert.deepEqual(
    lanes.map((lane) => lane.id),
    canonicalScripts,
  );
  assert.deepEqual(
    lanes.map((lane) => lane.pnpmArgs),
    canonicalScripts.map((script) => [script]),
  );
  assert.deepEqual(
    lanes.map((lane) => lane.repro),
    canonicalScripts.map((script) => `pnpm ${script}`),
  );
  assert.equal(
    lanes.some((lane) => lane.id.endsWith(':agent')),
    false,
  );
});

test('full check stops at the first failed canonical lane and retains its exit result', async () => {
  const invoked = [];
  const results = await runFullCheckLanes({
    lanes: buildFullCheckLanes(),
    runLane: async (lane) => {
      invoked.push(lane.id);
      return buildFullCheckLaneResult({
        lane,
        exitCode: lane.id === 'test:unit:prebuilt' ? 37 : 0,
        durationMs: 100,
        output: `${lane.id} output`,
      });
    },
  });

  assert.deepEqual(invoked, ['test:tooling', 'build', 'typecheck', 'lint', 'test:unit:prebuilt']);
  assert.deepEqual(
    results.map((result) => [result.name, result.status, result.exitCode]),
    [
      ['test:tooling', 'pass', 0],
      ['build', 'pass', 0],
      ['typecheck', 'pass', 0],
      ['lint', 'pass', 0],
      ['test:unit:prebuilt', 'fail', 37],
    ],
  );
});

test('failed full checks retain the complete plan and mark later lanes as not run', () => {
  const lanes = buildFullCheckLanes();
  const results = [
    buildFullCheckLaneResult({
      lane: lanes[0],
      exitCode: 0,
      durationMs: 100,
      output: 'tooling passed',
    }),
    buildFullCheckLaneResult({
      lane: lanes[1],
      exitCode: 41,
      durationMs: 200,
      output: 'build failed',
    }),
  ];

  const evidence = buildFullCheckEvidence({ lanes, results });
  const persistedSummary = JSON.parse(
    JSON.stringify({
      ...buildAgentCheckSummary({
        label: 'check:agent',
        durationMs: 300,
        lanes: results,
      }),
      ...evidence,
    }),
  );

  assert.deepEqual(
    persistedSummary.lanes.map((lane) => [lane.name, lane.status, lane.exitCode]),
    [
      ['test:tooling', 'pass', 0],
      ['build', 'fail', 41],
    ],
  );
  assert.deepEqual(
    persistedSummary.plannedLanes.map((lane) => lane.name),
    canonicalScripts,
  );
  assert.deepEqual(
    persistedSummary.notRun.map((lane) => [lane.name, lane.status, lane.reason, lane.stoppedAfter]),
    [
      ['typecheck', 'not_run', 'stopped_after_first_failure', 'build'],
      ['lint', 'not_run', 'stopped_after_first_failure', 'build'],
      ['test:unit:prebuilt', 'not_run', 'stopped_after_first_failure', 'build'],
      ['test:integration:prebuilt', 'not_run', 'stopped_after_first_failure', 'build'],
      ['test:backend:db:worker', 'not_run', 'stopped_after_first_failure', 'build'],
    ],
  );
  assert.equal(
    persistedSummary.notRun.some((lane) => ['pass', 'fail', 'blocked'].includes(lane.status)),
    false,
  );
});

test('agent presentation records canonical-lane diagnostics with the shared artifact protocol', () => {
  const lane = buildFullCheckLanes()[4];
  const artifacts = buildAgentCheckArtifacts({
    repoRoot: 'D:/code/esl-pipeline',
    runLabel: 'check:agent',
    lane: lane.id,
    timestamp: '2026-09-06T00-00-00-000Z',
  });
  const result = buildFullCheckLaneResult({
    lane,
    exitCode: 1,
    durationMs: 12_500,
    output: compactSignal(
      `${Array.from({ length: 20 }, (_, index) => `noisy line ${String(index + 1)}`).join('\n')}\nFAIL packages/example.test.ts\n1 failed | 472 passed\n`,
    ),
    artifacts: { rawLog: artifacts.rawLog.replace('D:/code/esl-pipeline/', '') },
  });
  const summary = buildAgentCheckSummary({
    label: 'check:agent',
    durationMs: 12_500,
    lanes: [result],
  });
  const text = formatAgentCheckSummary(summary, {
    logsDir: artifacts.runDir.replace('D:/code/esl-pipeline/', ''),
  });

  assert.equal(result.repro, 'pnpm test:unit:prebuilt');
  assert.equal(result.artifacts.rawLog.endsWith('/test-unit-prebuilt/raw.log'), true);
  assert.match(text, /check:agent FAIL/u);
  assert.match(text, /lane test:unit:prebuilt failed/u);
  assert.match(text, /1 failed \| 472 passed/u);
  assert.match(text, /raw log: tmp\/check-logs\//u);
  assert.doesNotMatch(text, /noisy line 1\n/u);
});
