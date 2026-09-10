import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAffectedCheckExecution } from './run-affected-check-lib.mjs';

const affectedPlan = {
  fallback: null,
  ciRequirements: [],
};
const fallbackPlan = {
  fallback: {
    lane: 'check:pre-pr',
    reason: 'root validation, package manager, TypeScript, Vitest, Biome, or Turbo config changed',
  },
  ciRequirements: [
    {
      id: 'backend-db-integration',
      reason: 'changed scope requires conservative hosted service evidence',
    },
  ],
};

test('affected agent execution retains normal local affected lanes', () => {
  const execution = resolveAffectedCheckExecution({
    plan: affectedPlan,
    agentMode: true,
    broadRun: false,
  });

  assert.equal(execution.executeLanes, true);
  assert.equal(execution.deferredBroadFallback, null);
  assert.deepEqual(execution.ciRequirements, []);
});

test('affected agent fallback defers broad local lanes to hosted CI', () => {
  const execution = resolveAffectedCheckExecution({
    plan: fallbackPlan,
    agentMode: true,
    broadRun: false,
  });

  assert.equal(execution.executeLanes, false);
  assert.deepEqual(execution.deferredBroadFallback, fallbackPlan.fallback);
  assert.deepEqual(execution.ciRequirements, [
    ...fallbackPlan.ciRequirements,
    {
      id: 'CI gate',
      reason:
        'affected routing requires conservative broad validation; hosted PR CI owns comprehensive regression',
    },
  ]);
});

test('explicit broad agent execution still runs the broad local plan', () => {
  const execution = resolveAffectedCheckExecution({
    plan: fallbackPlan,
    agentMode: true,
    broadRun: true,
  });

  assert.equal(execution.executeLanes, true);
  assert.equal(execution.deferredBroadFallback, null);
  assert.deepEqual(execution.ciRequirements, fallbackPlan.ciRequirements);
});
