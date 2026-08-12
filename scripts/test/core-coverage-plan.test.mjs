import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCoreCoveragePlan } from './core-coverage-plan.mjs';

test('core coverage prepares the selected build graph before prebuilt unit lanes', () => {
  const plan = buildCoreCoveragePlan();

  assert.deepEqual(plan.preparation.args, [
    'exec',
    'turbo',
    'run',
    'build',
    '--filter',
    '@esl-pipeline/batch-frontend',
    '--filter',
    '@esl-pipeline/batch-backend',
    '--filter',
    '@esl-pipeline/orchestrator',
    '--filter',
    '@esl-pipeline/tts-provider-elevenlabs',
  ]);
  assert.deepEqual(
    plan.coverage.map((target) => [target.packageName, target.args.slice(0, 4)]),
    [
      ['@esl-pipeline/batch-frontend', ['--filter', '@esl-pipeline/batch-frontend', 'run', 'test:unit:prebuilt']],
      ['@esl-pipeline/batch-backend', ['--filter', '@esl-pipeline/batch-backend', 'run', 'test:unit:prebuilt']],
      ['@esl-pipeline/orchestrator', ['--filter', '@esl-pipeline/orchestrator', 'run', 'test:unit:prebuilt']],
      [
        '@esl-pipeline/tts-provider-elevenlabs',
        ['--filter', '@esl-pipeline/tts-provider-elevenlabs', 'run', 'test:unit:prebuilt'],
      ],
    ],
  );
});
