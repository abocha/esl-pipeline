import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const placeholderSha = '0000000000000000000000000000000000000000';
const placeholderBackendImage = `ghcr.io/abocha/esl-pipeline/batch-backend:${placeholderSha}`;
const placeholderFrontendImage = `ghcr.io/abocha/esl-pipeline/batch-frontend:${placeholderSha}`;

function renderProdComposeConfig() {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-p',
      'esl-pipeline-prod',
      '-f',
      'docker-compose.prod.yml',
      'config',
      '--format',
      'json',
      '--no-env-resolution',
    ],
    {
      cwd: new URL('../..', import.meta.url),
      env: {
        ...process.env,
        BATCH_BACKEND_IMAGE: placeholderBackendImage,
        BATCH_FRONTEND_IMAGE: placeholderFrontendImage,
      },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('production Compose includes the dedicated student-memory worker service', () => {
  const config = renderProdComposeConfig();
  const service = config.services['student-memory-worker'];

  assert.ok(service, 'student-memory-worker service should be present');
  assert.equal(service.image, placeholderBackendImage);
  assert.deepEqual(service.command, ['node', 'dist/transport/student-memory-worker.js']);
  assert.equal(service.environment.NODE_ENV, 'production');
  assert.equal(service.environment.PG_APPLICATION_NAME, 'esl-pipeline-student-memory-worker');
  assert.equal(service.environment.PG_POOL_MAX, '4');
  assert.equal(service.depends_on.postgres.condition, 'service_healthy');
  assert.equal(service.depends_on.redis.condition, 'service_started');
});

test('production backend-image services mount Google credentials read-only', () => {
  const config = renderProdComposeConfig();
  const services = ['batch-backend', 'batch-worker', 'student-memory-worker', 'transcribe-worker'];

  for (const serviceName of services) {
    const service = config.services[serviceName];
    assert.ok(service, `${serviceName} service should be present`);
    assert.equal(
      service.environment.GOOGLE_APPLICATION_CREDENTIALS,
      '/app/secrets/google-service-account.json',
      `${serviceName} should use the mounted container credential path`,
    );

    const secretsMount = service.volumes.find((volume) => {
      const source = String(volume.source ?? '').replaceAll('\\', '/');
      return source.endsWith('/.secrets') && volume.target === '/app/secrets';
    });
    assert.ok(secretsMount, `${serviceName} should mount the server-local .secrets directory`);
    assert.equal(secretsMount.read_only, true, `${serviceName} .secrets mount should be read-only`);
  }
});
