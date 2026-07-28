import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyBackendTests,
  readBackendTestRouting,
  validateBackendTestRouting,
} from './backend-test-routing-lib.mjs';

const routing = {
  version: 1,
  deterministicIntegration: { prefixes: ['transport.http-server.integration.'] },
  postgresMigrations: ['integration.migrations.test.ts'],
  postgres: ['domain.student-memory-openai-batch-repository.test.ts'],
  postgresRedisWorker: ['transport.worker-runner.integration.test.ts'],
};

const testFiles = [
  'application.pure.test.ts',
  'domain.student-memory-openai-batch-repository.test.ts',
  'integration.migrations.test.ts',
  'transport.http-server.integration.assignment-sessions.test.ts',
  'transport.worker-runner.integration.test.ts',
];

const backendScripts = {
  'test:unit': unitScript(),
  'test:unit:prebuilt': unitScript(),
  'test:unit:timings': unitScript(),
  'test:integration:http': 'vitest run transport.http-server.integration.',
  'test:db:migrations': 'vitest run tests/integration.migrations.test.ts',
  'test:db:postgres': 'vitest run tests/domain.student-memory-openai-batch-repository.test.ts',
  'test:integration:worker': 'vitest run tests/transport.worker-runner.integration.test.ts',
};

test('reads the versioned backend routing manifest', () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'backend-routing-'));
  const manifestDir = path.join(repoRoot, 'packages', 'batch-backend', 'tests');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(path.join(manifestDir, 'test-routing.json'), JSON.stringify(routing), 'utf8');

  assert.deepEqual(readBackendTestRouting(repoRoot), routing);
});

test('classifies backend tests by operational prerequisite', () => {
  const classifications = classifyBackendTests({ testFiles, routing });
  const groupOf = (file) =>
    Object.entries(classifications).find(([, files]) => files.includes(file))?.[0];

  assert.equal(groupOf('domain.student-memory-openai-batch-repository.test.ts'), 'postgres');
  assert.equal(groupOf('integration.migrations.test.ts'), 'postgresMigrations');
  assert.equal(
    groupOf('transport.http-server.integration.assignment-sessions.test.ts'),
    'deterministicIntegration',
  );
  assert.equal(groupOf('transport.worker-runner.integration.test.ts'), 'postgresRedisWorker');
  assert.equal(groupOf('application.pure.test.ts'), 'unit');
});

test('accepts a complete, exclusive routing contract', () => {
  assert.deepEqual(validateFixture(), []);
});

test('rejects an otherwise-unit test that imports a service bootstrap', () => {
  const violations = validateFixture({
    sourceImports: {
      ...sourceImports(),
      'application.pure.test.ts':
        "import './support/bootstrap-pg-test-env.ts';\nvoid 'application';\n",
    },
  });

  assert.match(violations.join('\n'), /application\.pure\.test\.ts.*bootstrap-pg-test-env/iu);
});

test('rejects a service test missing from its service script', () => {
  const violations = validateFixture({
    backendScripts: { ...backendScripts, 'test:db:postgres': 'vitest run another.test.ts' },
  });

  assert.match(
    violations.join('\n'),
    /domain\.student-memory-openai-batch-repository\.test\.ts.*test:db:postgres/iu,
  );
});

test('rejects a service test that can enter a unit script', () => {
  const violations = validateFixture({
    backendScripts: {
      ...backendScripts,
      'test:unit:prebuilt': 'vitest run --dir tests',
    },
  });

  assert.match(
    violations.join('\n'),
    /domain\.student-memory-openai-batch-repository\.test\.ts.*test:unit:prebuilt/iu,
  );
});

test('rejects a file owned by two service groups', () => {
  const classifications = classifyBackendTests({
    testFiles,
    routing: {
      ...routing,
      postgresRedisWorker: [
        ...routing.postgresRedisWorker,
        'domain.student-memory-openai-batch-repository.test.ts',
      ],
    },
  });

  const violations = validateBackendTestRouting({
    classifications,
    backendScripts,
    sourceImports: sourceImports(),
  });

  assert.match(
    violations.join('\n'),
    /domain\.student-memory-openai-batch-repository\.test\.ts.*multiple service groups/iu,
  );
});

test('rejects a manifest entry that does not exist', () => {
  const classifications = classifyBackendTests({
    testFiles,
    routing: {
      ...routing,
      postgres: [...routing.postgres, 'domain.missing-repository.test.ts'],
    },
  });

  const violations = validateBackendTestRouting({
    classifications,
    backendScripts: {
      ...backendScripts,
      'test:db:postgres': `${backendScripts['test:db:postgres']} domain.missing-repository.test.ts`,
    },
    sourceImports: sourceImports(),
  });

  assert.match(violations.join('\n'), /domain\.missing-repository\.test\.ts.*does not exist/iu);
});

function validateFixture(overrides = {}) {
  return validateBackendTestRouting({
    classifications: classifyBackendTests({ testFiles, routing }),
    backendScripts,
    sourceImports: sourceImports(),
    ...overrides,
  });
}

function sourceImports() {
  return Object.fromEntries(testFiles.map((file) => [file, `void '${file}';\n`]));
}

function unitScript() {
  const excludes = testFiles
    .filter((file) => file !== 'application.pure.test.ts')
    .map((file) => `--exclude "**/${file}"`)
    .join(' ');
  return `vitest run --dir tests ${excludes}`;
}
