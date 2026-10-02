import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { matchesReadiness, WORKERS } from '../deploy/verify-workers-ready.mjs';
import { collectDockerObservation } from '../docker/host-runtime-health-alert.mjs';
import {
  collectQueueObservation,
  evaluateQueueObservation,
} from '../docker/worker-queue-observation.mjs';

const revision = process.argv[2];
const execute = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const docker = collectDockerObservation({ ESL_HOST_HEALTH_COMPOSE_PROJECT: 'esl-recovery' });
assert.equal(docker.ok, true);
const queues = await collectQueueObservation({ REDIS_HOST: 'redis', REDIS_PORT: '6379' }, docker);
assert.equal(queues.ok, true);
const evaluated = evaluateQueueObservation(queues, {}, Date.now());
assert.equal(evaluated.queues.length, 3);
assert.ok(evaluated.queues.every((queue) => queue.state === 'idle' && queue.consumers.length > 0));
assert.equal(evaluated.issues.length, 0);
writeFileSync('/evidence/queue-monitor.json', JSON.stringify(evaluated, null, 2));
const instances = [];
for (const worker of WORKERS) {
  const container = docker.containers.find((row) => row.service === worker.service);
  const inspected = JSON.parse(execute('docker', ['inspect', container.id]))[0];
  assert.equal(inspected.Config.Labels['org.opencontainers.image.revision'], revision);
  const records = execute('docker', ['logs', '--since', inspected.State.StartedAt, container.id])
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const readiness = records.find((record) => matchesReadiness(record, inspected, worker));
  assert.ok(readiness);
  instances.push({
    service: worker.service,
    containerId: inspected.Id,
    imageId: inspected.Image,
    startedAt: inspected.State.StartedAt,
    readiness,
  });
}
writeFileSync('/evidence/worker-instances.json', JSON.stringify(instances, null, 2));
for (const name of [
  'esl-postgres-backup',
  'esl-postgres-artifact-integrity',
  'esl-postgres-restore-drill',
  'esl-postgres-ops-alert',
  'esl-host-runtime-health',
]) {
  assert.equal(execute('systemctl', ['is-enabled', `${name}.timer`]), 'enabled');
  assert.equal(
    execute('systemctl', ['show', `${name}.timer`, '-p', 'LastTriggerUSec', '--value']),
    '',
  );
  assert.equal(
    execute('systemctl', ['show', `${name}.service`, '-p', 'ExecMainStartTimestamp', '--value']),
    '',
  );
  assert.equal(
    readFileSync(`/etc/systemd/system/${name}.service`, 'utf8'),
    readFileSync(`deploy/systemd/${name}.service`, 'utf8'),
  );
}
const tables = [
  'users',
  'workspaces',
  'workspace_memberships',
  'students',
  'student_lessons',
  'assignment_sessions',
  'recordings',
  'transcripts',
  'prompt_packages',
  'drafts',
  'student_profile_revisions',
];
const postgres = docker.containers.find((row) => row.service === 'postgres');
const counts = {};
for (const table of tables) {
  counts[table] = Number(
    execute('docker', [
      'exec',
      postgres.id,
      'psql',
      '-U',
      'esl',
      '-d',
      'esl_batch',
      '-Atqc',
      `SELECT count(*) FROM ${table}`,
    ]),
  );
  assert.ok(counts[table] > 0, `Missing restored ${table}`);
}
writeFileSync('/evidence/restored-database.json', JSON.stringify(counts, null, 2));
const health = JSON.parse(readFileSync('/evidence/edge-health.json', 'utf8'));
assert.equal(health.ok, true);
const html = readFileSync('/evidence/frontend.html', 'utf8');
assert.match(html, /<html|<!doctype/iu);
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/gu)].map(
  (match) => match[1],
);
assert.ok(assets.length > 0);
const assetEvidence = [];
for (const asset of assets) {
  const response = await fetch(`http://127.0.0.1:18081${asset}`, {
    headers: { host: 'recovery.invalid' },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  const bytes = (await response.arrayBuffer()).byteLength;
  assert.ok(bytes > 0);
  const contentType = response.headers.get('content-type') ?? '';
  assert.match(contentType, asset.endsWith('.css') ? /^text\/css\b/u : /javascript|ecmascript/u);
  assetEvidence.push({
    path: asset,
    status: response.status,
    bytes,
    contentType,
  });
}
writeFileSync('/evidence/frontend-assets.json', JSON.stringify(assetEvidence, null, 2));
const product = JSON.parse(readFileSync('/evidence/recovered-product.json', 'utf8'));
assert.equal(product.ok, true);
assert.equal(product.authenticatedThroughCaddy, true);
const current = readFileSync('/var/lib/esl-pipeline/deploy/current-images.env', 'utf8');
assert.ok(current.includes(revision));
assert.match(current, /BATCH_BACKEND_DIGEST=.*sha256:[a-f0-9]{64}/u);
assert.match(current, /BATCH_FRONTEND_DIGEST=.*sha256:[a-f0-9]{64}/u);
writeFileSync('/evidence/current-images.env', current);
const result = {
  schemaVersion: 1,
  outcome: 'disposable-recovery-proven',
  productionRecoveryProven: false,
  applicationRevision: revision,
  dockerStorageDriver: execute('docker', ['info', '--format', '{{.Driver}}']),
  host: 'Clean Ubuntu 24.04 systemd Docker guest; separate source and replacement local daemons',
  invariants: [
    'repository bootstrap',
    'real PostgreSQL dump restore',
    'image/schema compatibility',
    'uploads and quiet Redis AOF restored',
    'normal SHA/digest pull deployment',
    'backend and Caddy/frontend/API health',
    'authenticated persisted student/lesson/session/recording/draft reads',
    'three current-instance BullMQ readiness records',
    'three healthy idle queue consumers',
    'backup/monitor units installed, timers never triggered',
  ],
  limitations: [
    'Containerized Ubuntu shares the disposable runner kernel; no VPS or SSH reachability evidence',
    'Locally built production Dockerfiles and disposable registry; no GHCR authorization evidence',
    'Local S3 emulator and synthetic credentials; no real S3/KMS/IAM backup retrieval',
    'Local HTTP Caddy route; no public DNS, ACME or TLS evidence',
    'No paid provider success; guest firewall blocks container Internet egress',
    'Quiet Redis snapshot; no in-flight job replay or cross-store crash-consistency claim',
  ],
};
writeFileSync('/evidence/recovery-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
