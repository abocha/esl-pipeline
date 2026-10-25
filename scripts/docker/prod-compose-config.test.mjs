import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const placeholderSha = '0000000000000000000000000000000000000000';
const placeholderBackendImage = `ghcr.io/abocha/esl-pipeline/batch-backend:${placeholderSha}`;
const placeholderFrontendImage = `ghcr.io/abocha/esl-pipeline/batch-frontend:${placeholderSha}`;
const productionComposeFile = fileURLToPath(
  new URL('../../docker-compose.prod.yml', import.meta.url),
);

function renderProdComposeConfig() {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'esl-pipeline-prod-compose-'));
  const fixtureComposeFile = path.join(fixtureDir, 'docker-compose.prod.yml');
  copyFileSync(productionComposeFile, fixtureComposeFile);
  writeFileSync(
    path.join(fixtureDir, 'production.env'),
    'PG_DATABASE=fixture_database\nPG_USER=fixture_user\nBATCH_BACKEND_HOST_PORT=18888\n',
  );

  writeFileSync(
    path.join(fixtureDir, '.env'),
    'PG_DATABASE=stale_database\nPG_USER=stale_user\nBATCH_BACKEND_HOST_PORT=19999\n',
  );
  writeFileSync(
    path.join(fixtureDir, 'images.env'),
    `BATCH_BACKEND_IMAGE=${placeholderBackendImage}\nBATCH_FRONTEND_IMAGE=${placeholderFrontendImage}\n`,
  );
  const fixtureEnv = {
    ...process.env,
    ESL_PRODUCTION_ENV_FILE: path.join(fixtureDir, 'production.env'),
  };
  delete fixtureEnv.PG_DATABASE;
  delete fixtureEnv.PG_USER;
  delete fixtureEnv.BATCH_BACKEND_HOST_PORT;
  delete fixtureEnv.BATCH_BACKEND_IMAGE;
  delete fixtureEnv.BATCH_FRONTEND_IMAGE;
  try {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '-p',
        'esl-pipeline-prod',
        '-f',
        fixtureComposeFile,
        '--env-file',
        path.join(fixtureDir, 'production.env'),
        '--env-file',
        path.join(fixtureDir, 'images.env'),
        'config',
        '--format',
        'json',
      ],
      {
        cwd: fixtureDir,
        env: fixtureEnv,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
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

test('production batch-worker mounts the dedicated named TTS cache volume', () => {
  const config = renderProdComposeConfig();
  const worker = config.services['batch-worker'];

  assert.ok(worker, 'batch-worker service should be present');
  const cacheMount = worker.volumes.find((volume) => volume.target === '/app/tmp/tts-cache');
  assert.ok(cacheMount, 'batch-worker should mount the TTS cache path');
  assert.equal(cacheMount.type, 'volume', 'TTS cache should use a Docker named volume');

  const declaredVolume = config.volumes.tts_cache;
  assert.ok(declaredVolume, 'production Compose should declare the TTS cache volume');
  assert.equal(
    cacheMount.source,
    'tts_cache',
    'TTS cache mount should use its declared volume key',
  );
  assert.match(declaredVolume.name, /_tts_cache$/u, 'TTS cache volume should be project-scoped');

  for (const [serviceName, service] of Object.entries(config.services)) {
    if (serviceName === 'batch-worker') continue;
    assert.equal(
      Boolean(service.volumes?.some((volume) => volume.target === '/app/tmp/tts-cache')),
      false,
      `${serviceName} should not mount the batch-worker TTS cache volume`,
    );
  }
});

test('production runtime and interpolation use protected env plus image state, ignoring stale checkout env', () => {
  const config = renderProdComposeConfig();
  for (const name of [
    'batch-backend',
    'batch-worker',
    'transcribe-worker',
    'student-memory-worker',
  ]) {
    assert.equal(config.services[name].environment.PG_DATABASE, 'fixture_database', name);
    assert.equal(config.services[name].environment.PG_USER, 'fixture_user', name);
  }
  assert.equal(config.services['batch-backend'].ports[0].published, '18888');
});
