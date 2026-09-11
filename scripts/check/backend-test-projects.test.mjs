import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  BACKEND_TEST_PROJECT_FILES,
  BACKEND_TEST_PROJECT_NAMES,
  BACKEND_TEST_PROJECTS,
  resolveBackendTestProjectFiles,
} from '../../packages/batch-backend/vitest.projects.mjs';

const packageRoot = path.resolve('packages/batch-backend');
const packageManifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const pureServiceSignals = [
  'support/bootstrap-pg-test-env',
  'requirePgTestEnv',
  'requireRedisTestEnv',
  'BATCH_BACKEND_TEST_PG',
  'BATCH_BACKEND_TEST_REDIS',
];
const pureServiceSignalExemptions = new Set([
  'bootstrap.pg-test-env.test.ts',
  'config.pure-environment.test.ts',
  'support/test-env.test.ts',
]);

test('backend projects explicitly own service prerequisites and derive pure as the complement', () => {
  assert.deepEqual(BACKEND_TEST_PROJECT_NAMES, [
    'pure',
    'http',
    'migrations',
    'postgres',
    'worker',
    'media',
  ]);

  const serviceOwners = new Map();
  for (const [projectName, files] of Object.entries(BACKEND_TEST_PROJECT_FILES)) {
    if (projectName === 'pure') continue;
    for (const file of files) {
      const owners = serviceOwners.get(file) ?? [];
      owners.push(projectName);
      serviceOwners.set(file, owners);
      assert.equal(
        existsSync(path.join(packageRoot, 'tests', file)),
        true,
        `${projectName} entry ${file} must exist`,
      );
    }
  }

  const overlaps = [...serviceOwners.entries()].filter(([, owners]) => owners.length > 1);
  assert.deepEqual(overlaps, []);

  const projectByName = new Map(
    BACKEND_TEST_PROJECTS.map((project) => [project.test.name, project.test]),
  );
  assert.deepEqual([...projectByName.keys()], BACKEND_TEST_PROJECT_NAMES);
  for (const [projectName, files] of Object.entries(BACKEND_TEST_PROJECT_FILES)) {
    assert.deepEqual(
      projectByName.get(projectName)?.include,
      files.map((file) => `tests/${file}`),
      `${projectName} config include must match its prerequisite entries`,
    );
  }
  assert.deepEqual(
    BACKEND_TEST_PROJECT_FILES.pure.filter((file) => serviceOwners.has(file)),
    [],
  );

  const discoveredFiles = discoverTestFiles(path.join(packageRoot, 'tests'));
  const assignedFiles = Object.values(BACKEND_TEST_PROJECT_FILES).flat();
  assert.equal(new Set(assignedFiles).size, assignedFiles.length);
  assert.deepEqual([...assignedFiles].sort(), discoveredFiles);
  assert.deepEqual(
    BACKEND_TEST_PROJECT_FILES.http,
    discoveredFiles.filter((file) => file.startsWith('transport.http-server.integration.')),
  );
});

test('backend project resolver rejects missing and overlapping explicit entries', () => {
  assert.throws(
    () =>
      resolveBackendTestProjectFiles({
        discoveredFiles: ['pure.test.ts'],
        explicitProjectFiles: { postgres: ['missing.test.ts'] },
      }),
    /entries do not exist: missing\.test\.ts/u,
  );
  assert.throws(
    () =>
      resolveBackendTestProjectFiles({
        discoveredFiles: ['shared.test.ts'],
        explicitProjectFiles: {
          postgres: ['shared.test.ts'],
          worker: ['shared.test.ts'],
        },
      }),
    /projects overlap: shared\.test\.ts \(postgres, worker\)/u,
  );
});

test('derived pure project rejects known PostgreSQL and Redis bootstrap signals', () => {
  const violations = [];
  for (const file of BACKEND_TEST_PROJECT_FILES.pure) {
    if (pureServiceSignalExemptions.has(file)) continue;
    const source = readFileSync(path.join(packageRoot, 'tests', file), 'utf8');
    for (const signal of pureServiceSignals) {
      if (source.includes(signal)) violations.push(`${file}: ${signal}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('backend service projects are serial and package scripts select named projects', () => {
  for (const projectName of ['migrations', 'postgres', 'worker', 'media']) {
    const project = BACKEND_TEST_PROJECTS.find((entry) => entry.test.name === projectName)?.test;
    assert.equal(project?.maxWorkers, 1, `${projectName} must use one worker`);
    assert.equal(project?.fileParallelism, false, `${projectName} must disable file parallelism`);
  }

  const expectedScripts = {
    'test:unit': 'pure',
    'test:unit:prebuilt': 'pure',
    'test:unit:timings': 'pure',
    'test:integration:http': 'http',
    'test:db:migrations': 'migrations',
    'test:db:postgres': 'postgres',
    'test:integration:worker': 'worker',
    'test:media': 'media',
  };
  for (const [scriptName, projectName] of Object.entries(expectedScripts)) {
    assert.match(
      packageManifest.scripts[scriptName],
      new RegExp(`--project\\s+${projectName}\\b`, 'u'),
      `${scriptName} must select the ${projectName} project`,
    );
  }

  const pureProject = BACKEND_TEST_PROJECTS.find((entry) => entry.test.name === 'pure')?.test;
  assert.equal(pureProject?.maxWorkers, 2);
  for (const name of [
    'BATCH_BACKEND_TEST_PG',
    'PG_CONNECTION_STRING',
    'REDIS_HOST',
    'REDIS_PORT',
    'OPENAI_API_KEY',
  ]) {
    assert.equal(
      typeof pureProject?.env?.[name],
      'string',
      `${name} must be poisoned by the project`,
    );
    assert.notEqual(
      pureProject?.env?.[name],
      '',
      `${name} poison must be observable if scrub fails`,
    );
  }
});

test('service projects construct their environment before test modules load', () => {
  const projectEnvSource = readFileSync(
    path.join(packageRoot, 'tests', 'setup', 'project-env.mjs'),
    'utf8',
  );
  const postgresSetupSource = readFileSync(
    path.join(packageRoot, 'tests', 'setup', 'postgres.mjs'),
    'utf8',
  );
  const workerSetupSource = readFileSync(
    path.join(packageRoot, 'tests', 'setup', 'worker.mjs'),
    'utf8',
  );
  assert.match(projectEnvSource, /requirePgTestRuntimeEnv/iu);
  assert.match(projectEnvSource, /requireRedisTestEnv/iu);
  assert.match(projectEnvSource, /VALIDATION_TEST_CLASS = 'postgres'/u);
  assert.match(projectEnvSource, /VALIDATION_TEST_CLASS = 'postgres-redis-worker'/u);
  assert.match(postgresSetupSource, /configurePostgresTestEnvironment/iu);
  assert.match(workerSetupSource, /configureWorkerTestEnvironment/iu);
});

function discoverTestFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.posix.join(prefix, entry.name);
      return entry.isDirectory()
        ? discoverTestFiles(path.join(directory, entry.name), relativePath)
        : [relativePath];
    })
    .filter((file) => file.endsWith('.test.ts'))
    .sort();
}
