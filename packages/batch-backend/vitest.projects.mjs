import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const testsRoot = path.join(packageRoot, 'tests');
const discoveredFiles = discoverTestFiles(testsRoot);

const deterministicHttpFiles = discoveredFiles.filter((file) =>
  file.startsWith('transport.http-server.integration.'),
);

const postgresMigrationsFiles = ['integration.migrations.test.ts'];

const postgresFiles = [
  'domain.job-repository.test.ts',
  'domain.revision-repository.test.ts',
  'domain.lesson-memory-repository.test.ts',
  'domain.homework-memory-repository.test.ts',
  'domain.student-profile-candidate-repository.test.ts',
  'domain.student-memory-snapshot-repository.test.ts',
  'domain.student-memory-openai-batch-import.test.ts',
  'domain.student-memory-openai-batch-repository.test.ts',
  'domain.assignment-session-repository.test.ts',
  'domain.recording-audio-cleanup-repository.test.ts',
  'domain.student-repository.workspace.test.ts',
  'integration.recording-tenant-authority.test.ts',
  'application.assignment-step-confirmation.test.ts',
  'application.homework-memory-source.test.ts',
  'application.student-timeline.test.ts',
  'application.student-schedule-billing.test.ts',
  'application.alpha-invites.registration.test.ts',
  'integration.query-plan-regression.test.ts',
];

const workerFiles = [
  'transport.worker-runner.integration.test.ts',
  'integration.student-memory-pacing-delay.test.ts',
  'integration.assignment-share-recovery.redis.test.ts',
  'infrastructure.transcribe-queue.redis.integration.test.ts',
  'integration.transcription-execution-worker.redis.test.ts',
];

const mediaFiles = ['infrastructure.recording-media.test.ts'];

const explicitProjectFiles = {
  http: Object.freeze([...deterministicHttpFiles]),
  migrations: Object.freeze([...postgresMigrationsFiles]),
  postgres: Object.freeze([...postgresFiles]),
  worker: Object.freeze([...workerFiles]),
  media: Object.freeze([...mediaFiles]),
};

export const BACKEND_TEST_PROJECT_FILES = resolveBackendTestProjectFiles({
  discoveredFiles,
  explicitProjectFiles,
});

export const BACKEND_TEST_PROJECT_NAMES = Object.freeze(Object.keys(BACKEND_TEST_PROJECT_FILES));

const setupFiles = {
  pure: './tests/setup/pure.mjs',
  http: './tests/setup/http.mjs',
  migrations: './tests/setup/postgres.mjs',
  postgres: './tests/setup/postgres.mjs',
  worker: './tests/setup/worker.mjs',
  media: './tests/setup/media.mjs',
};

const constrainedProjectOptions = Object.freeze({ maxWorkers: 1, fileParallelism: false });
const poisonedPureProjectEnv = Object.freeze({
  BATCH_BACKEND_TEST_PG: 'postgresql://ambient.invalid:5432/esl_batch',
  PG_CONNECTION_STRING: 'postgresql://ambient.invalid:5432/esl_batch',
  REDIS_HOST: 'ambient.invalid',
  REDIS_PORT: '6379',
  OPENAI_API_KEY: 'ambient-provider-secret',
});

export const BACKEND_TEST_PROJECTS = Object.freeze([
  project('pure', BACKEND_TEST_PROJECT_FILES.pure, setupFiles.pure, {
    maxWorkers: 2,
    env: poisonedPureProjectEnv,
  }),
  project('http', BACKEND_TEST_PROJECT_FILES.http, setupFiles.http, constrainedProjectOptions),
  project(
    'migrations',
    BACKEND_TEST_PROJECT_FILES.migrations,
    setupFiles.migrations,
    constrainedProjectOptions,
  ),
  project(
    'postgres',
    BACKEND_TEST_PROJECT_FILES.postgres,
    setupFiles.postgres,
    constrainedProjectOptions,
  ),
  project(
    'worker',
    BACKEND_TEST_PROJECT_FILES.worker,
    setupFiles.worker,
    constrainedProjectOptions,
  ),
  project('media', BACKEND_TEST_PROJECT_FILES.media, setupFiles.media, constrainedProjectOptions),
]);

function project(name, files, setupFile, options) {
  return {
    test: {
      name,
      environment: 'node',
      globals: true,
      include: files.map((file) => `tests/${file}`),
      setupFiles: [setupFile],
      ...options,
    },
  };
}

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

export function resolveBackendTestProjectFiles({ discoveredFiles, explicitProjectFiles }) {
  const explicitOwners = new Map();
  for (const [projectName, files] of Object.entries(explicitProjectFiles)) {
    for (const file of files) {
      const owners = explicitOwners.get(file) ?? [];
      owners.push(projectName);
      explicitOwners.set(file, owners);
    }
  }

  const overlappingFiles = [...explicitOwners.entries()].filter(([, owners]) => owners.length > 1);
  if (overlappingFiles.length > 0) {
    throw new Error(
      `Backend Vitest projects overlap: ${overlappingFiles
        .map(([file, owners]) => `${file} (${owners.join(', ')})`)
        .join('; ')}`,
    );
  }

  const discoveredSet = new Set(discoveredFiles);
  const missingExplicitFiles = [...explicitOwners.keys()].filter(
    (file) => !discoveredSet.has(file),
  );
  if (missingExplicitFiles.length > 0) {
    throw new Error(
      `Backend Vitest project entries do not exist: ${missingExplicitFiles.join(', ')}`,
    );
  }

  return Object.freeze({
    pure: Object.freeze(discoveredFiles.filter((file) => !explicitOwners.has(file))),
    ...Object.fromEntries(
      Object.entries(explicitProjectFiles).map(([projectName, files]) => [
        projectName,
        Object.freeze([...files]),
      ]),
    ),
  });
}
