import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCiScopeGithubOutputs,
  formatCiScopeSummary,
  formatScopePreview,
} from './affected-check-lib.mjs';

const docsDecision = {
  runtime: false,
  integration: false,
  backend_db_worker: false,
  telegram: false,
  docs_only: true,
  changedFiles: ['docs/guide.md'],
  affectedPackages: [],
  reasons: [{ code: 'docs-only', scope: 'docs_only', subject: 'docs/guide.md' }],
};

test('GitHub outputs are single-line lowercase booleans only', () => {
  assert.equal(
    formatCiScopeGithubOutputs({
      runtime: true,
      integration: false,
      backend_db_worker: false,
      telegram: false,
      docs_only: false,
    }),
    'runtime=true\nintegration=false\nbackend_db_worker=false\ntelegram=false\ndocs_only=false\n',
  );
});

test('scope summary renders structured reasons without exporting prose', () => {
  assert.match(
    formatCiScopeSummary({
      runtime: true,
      integration: true,
      backend_db_worker: false,
      telegram: false,
      docs_only: false,
      changedFiles: ['packages/batch-frontend/src/main.tsx'],
      affectedPackages: ['@esl-pipeline/batch-frontend'],
      reasons: [
        {
          code: 'affected-package',
          scope: 'runtime',
          subject: '@esl-pipeline/batch-frontend',
        },
      ],
    }),
    /affected-package.*@esl-pipeline\/batch-frontend/u,
  );
});

test('dual preview keeps uncommitted paths out of hosted scope', () => {
  const text = formatScopePreview({
    planText: 'Local plan',
    hostedDecision: docsDecision,
    uncommittedFiles: ['scratch.ts'],
  });

  assert.match(text, /Local validation scope/u);
  assert.match(text, /Hosted CI preview/u);
  assert.match(text, /Hosted preview excludes 1 uncommitted path/u);
  assert.doesNotMatch(text, /scratch\.ts/u);
});
