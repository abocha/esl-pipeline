import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCiScopeGithubOutputs, formatCiScopeSummary } from './workspace-change-scope.mjs';

test('GitHub outputs are single-line lowercase booleans only', () => {
  assert.equal(
    formatCiScopeGithubOutputs({
      build_unit: true,
      integration: false,
      backend_db_worker: false,
      telegram: false,
      docs_only: false,
      maintenance_only: true,
    }),
    'build_unit=true\nmedia=false\nintegration=false\nbackend_db_worker=false\ntelegram=false\ndocs_only=false\nmaintenance_only=true\n',
  );
});

test('scope summary renders structured reasons without exporting prose', () => {
  assert.match(
    formatCiScopeSummary({
      build_unit: true,
      integration: true,
      backend_db_worker: false,
      telegram: false,
      docs_only: false,
      maintenance_only: false,
      changedFiles: ['packages/batch-frontend/src/main.tsx'],
      affectedPackages: ['@esl-pipeline/batch-frontend'],
      reasons: [
        {
          code: 'affected-package',
          scope: 'build_unit',
          subject: '@esl-pipeline/batch-frontend',
        },
      ],
    }),
    /affected-package.*@esl-pipeline\/batch-frontend/u,
  );
});
