import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBlockedLaneResult,
  buildExecutionLanes,
  resolveLaneDisposition,
  runExecutionLanes,
} from './execution-lane-lib.mjs';

test('execution lanes keep independent checks runnable and bind prebuilt consumers to build', () => {
  const lanes = buildExecutionLanes({
    triggeredLanes: [lane('guard:orchestrator:boundary'), lane('backend:test:integration:http')],
    turbo: {
      taskGroups: [
        turboGroup('build'),
        turboGroup('typecheck'),
        turboGroup('lint'),
        turboGroup('test:unit:prebuilt'),
      ],
    },
  });

  assert.deepEqual(laneById(lanes, 'guard:orchestrator:boundary').dependsOn, []);
  assert.deepEqual(laneById(lanes, 'turbo:typecheck').dependsOn, []);
  assert.deepEqual(laneById(lanes, 'turbo:lint').dependsOn, []);
  assert.deepEqual(laneById(lanes, 'turbo:test:unit:prebuilt').dependsOn, ['turbo:build']);
  assert.deepEqual(laneById(lanes, 'backend:test:integration:http').dependsOn, ['turbo:build']);
});

test('execution lanes do not invent a build dependency when no build lane was selected', () => {
  const lanes = buildExecutionLanes({
    triggeredLanes: [lane('backend:test:integration:http')],
    turbo: null,
  });

  assert.deepEqual(laneById(lanes, 'backend:test:integration:http').dependsOn, []);
});

test('broad prebuilt units depend on the explicit root build lane', () => {
  const lanes = buildExecutionLanes({
    triggeredLanes: [lane('build'), lane('typecheck'), lane('test:unit:prebuilt:fast')],
    turbo: null,
  });

  assert.deepEqual(laneById(lanes, 'typecheck').dependsOn, []);
  assert.deepEqual(laneById(lanes, 'test:unit:prebuilt:fast').dependsOn, ['build']);
});

test('failed dependencies block consumers while independent lanes still run', () => {
  const failedBuild = result('turbo:build', 'fail');

  assert.deepEqual(resolveLaneDisposition({ id: 'turbo:lint', dependsOn: [] }, [failedBuild]), {
    action: 'run',
  });
  assert.deepEqual(
    resolveLaneDisposition({ id: 'turbo:test:unit:prebuilt', dependsOn: ['turbo:build'] }, [
      failedBuild,
    ]),
    { action: 'block', blockedBy: ['turbo:build'] },
  );
});

test('blocked lane results name failed prerequisites without fabricating artifacts', () => {
  const blocked = buildBlockedLaneResult(
    {
      id: 'turbo:test:unit:prebuilt',
      repro: 'pnpm exec turbo run test:unit:prebuilt',
    },
    ['turbo:build'],
  );

  assert.deepEqual(blocked, {
    name: 'turbo:test:unit:prebuilt',
    status: 'blocked',
    exitCode: null,
    durationMs: 0,
    signal: 'blocked by failed prerequisite: turbo:build',
    blockedBy: ['turbo:build'],
    repro: 'pnpm exec turbo run test:unit:prebuilt',
    artifacts: {},
  });
});

test('serial execution collects independent failures and skips only blocked consumers', async () => {
  const lanes = [
    { id: 'guard', dependsOn: [], repro: 'pnpm guard' },
    { id: 'turbo:build', dependsOn: [], repro: 'pnpm build' },
    {
      id: 'turbo:test:unit:prebuilt',
      dependsOn: ['turbo:build'],
      repro: 'pnpm test:unit:prebuilt',
    },
    { id: 'turbo:lint', dependsOn: [], repro: 'pnpm lint' },
  ];
  const invoked = [];

  const results = await runExecutionLanes({
    lanes,
    runLane: async (laneEntry) => {
      invoked.push(laneEntry.id);
      return result(
        laneEntry.id,
        laneEntry.id === 'turbo:build' || laneEntry.id === 'turbo:lint' ? 'fail' : 'pass',
      );
    },
  });

  assert.deepEqual(invoked, ['guard', 'turbo:build', 'turbo:lint']);
  assert.deepEqual(
    results.map((laneResult) => [laneResult.name, laneResult.status]),
    [
      ['guard', 'pass'],
      ['turbo:build', 'fail'],
      ['turbo:test:unit:prebuilt', 'blocked'],
      ['turbo:lint', 'fail'],
    ],
  );
});

function lane(id) {
  return {
    id,
    pnpmArgs: ['run', id],
    reason: `${id} reason`,
    repro: `pnpm run ${id}`,
  };
}

function turboGroup(task) {
  return {
    id: `turbo:${task}`,
    task,
    args: ['exec', 'turbo', 'run', task],
    repro: `pnpm exec turbo run ${task}`,
  };
}

function result(name, status) {
  return { name, status };
}

function laneById(lanes, id) {
  return lanes.find((laneEntry) => laneEntry.id === id);
}
