import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const backendPackage = JSON.parse(
  readFileSync(new URL('../../packages/batch-backend/package.json', import.meta.url), 'utf8'),
);

test('student schedule billing PG suite is routed out of backend unit lanes', () => {
  const dbBackedTest = 'application.student-schedule-billing.test.ts';
  for (const scriptName of ['test:unit', 'test:unit:prebuilt', 'test:unit:timings']) {
    assert.match(
      backendPackage.scripts[scriptName],
      new RegExp(`\\*\\*/${escapeRegExp(dbBackedTest)}`),
      `${scriptName} must exclude ${dbBackedTest}`,
    );
  }
});

test('student schedule billing PG suite is covered by the backend postgres lane', () => {
  assert.match(
    backendPackage.scripts['test:db:postgres'],
    /application\.student-schedule-billing\.test\.ts/u,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
