import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const dockerfiles = new Map([
  ['backend', read('packages/batch-backend/Dockerfile')],
  ['frontend', read('packages/batch-frontend/Dockerfile')],
  ['bot', read('packages/telegram-ops-bot/Dockerfile')],
]);
const workspace = read('pnpm-workspace.yaml');
const backendPackage = JSON.parse(read('packages/batch-backend/package.json'));
const compose = read('docker-compose.prod.yml').replaceAll('\r\n', '\n');
const releaseWorkflow = read('.github/workflows/release-on-merge.yml');
const orchestratorPackage = JSON.parse(read('packages/orchestrator/package.json'));

const composeService = (serviceName) => {
  const heading = `\n  ${serviceName}:\n`;
  const start = compose.indexOf(heading);
  assert.notEqual(start, -1, `${serviceName}: service exists`);
  const bodyStart = start + heading.length;
  const nextService = /\n  \S[^\n]*:\n/u.exec(compose.slice(bodyStart));
  const end = nextService ? bodyStart + nextService.index : undefined;
  return compose.slice(start, end);
};

test('production application Node stages use Debian 13 slim and committed pnpm', () => {
  for (const [name, dockerfile] of dockerfiles) {
    assert.match(dockerfile, /FROM node:24-trixie-slim AS build/u, name);
    assert.doesNotMatch(dockerfile, /FROM node:[^\n]*alpine/u, name);
    assert.doesNotMatch(dockerfile, /corepack prepare|pnpm@10/u, name);
    assert.match(dockerfile, /corepack enable/u, name);
  }

  assert.match(dockerfiles.get('backend'), /FROM node:24-trixie-slim AS runtime/u);
  assert.match(dockerfiles.get('bot'), /FROM node:24-trixie-slim AS runtime/u);
});

test('production builders fetch from the lockfile before copying package sources', () => {
  for (const [name, dockerfile] of dockerfiles) {
    const fetchIndex = dockerfile.indexOf('pnpm fetch --frozen-lockfile');
    const packageCopyIndex = dockerfile.indexOf('COPY packages ./packages');
    assert.notEqual(fetchIndex, -1, `${name}: fetch`);
    assert.notEqual(packageCopyIndex, -1, `${name}: package copy`);
    assert.ok(fetchIndex < packageCopyIndex, `${name}: fetch precedes package source copy`);
    assert.match(
      dockerfile,
      /--mount=type=cache,id=pnpm-store,target=\/app\/\.pnpm-store\/v11/u,
      name,
    );
    assert.match(dockerfile, /install --offline --frozen-lockfile/u, name);
  }
});

test('runtime-specific system dependencies remain explicit', () => {
  const backend = dockerfiles.get('backend');
  const bot = dockerfiles.get('bot');
  assert.match(backend, /apt-get install -y --no-install-recommends/u);
  for (const dependency of ['ca-certificates', 'curl', 'ffmpeg']) {
    assert.match(backend, new RegExp(`\\b${dependency}\\b`, 'u'));
  }
  assert.match(bot, /ca-certificates/u);
  assert.doesNotMatch(backend, /\bapk add\b/u);
  assert.doesNotMatch(bot, /\bapk add\b/u);
});

test('workspace deployment uses injected packages synchronized after build', () => {
  assert.match(workspace, /^injectWorkspacePackages: true$/mu);
  assert.match(workspace, /^syncInjectedDepsAfterScripts:\r?\n  - build$/mu);
});

test('production deploys use dedicated lockfiles instead of legacy mode', () => {
  for (const name of ['backend', 'bot']) {
    const dockerfile = dockerfiles.get(name);
    assert.match(dockerfile, /deploy --prod \/app\/deployed/u, name);
    assert.doesNotMatch(dockerfile, /deploy --legacy/u, name);
  }
});

test('portable deployments reuse the cached store without persisting it', () => {
  for (const name of ['backend', 'bot']) {
    const dockerfile = dockerfiles.get(name);
    assert.match(
      dockerfile,
      /RUN --mount=type=cache,id=pnpm-store,target=\/app\/\.pnpm-store\/v11 \\\n    pnpm -r [^\n]+ run build/u,
      `${name}: deploy store cache mount`,
    );
    assert.match(
      dockerfile,
      /pnpm --store-dir=\/app\/\.pnpm-store\/v11 --offline --filter [^\n]+ deploy --prod \/app\/deployed/u,
      name,
    );
    assert.doesNotMatch(dockerfile, /rm -rf \/app\/deployed\/\.pnpm-store/u, name);
  }
});

test('backend deployment includes only runtime-owned package files', () => {
  assert.deepEqual(backendPackage.files, ['dist', 'migrations', 'schema.sql']);
});

test('backend runtime image copies the runtime-owned prompt asset tree', () => {
  assert.match(
    dockerfiles.get('backend'),
    /COPY --chown=node:node packages\/batch-backend\/prompt-assets \.\/packages\/batch-backend\/prompt-assets/u,
  );
  assert.doesNotMatch(dockerfiles.get('backend'), /docs\/prompt-gallery/u);
});

test('production infrastructure stays on controlled official image lines', () => {
  assert.match(dockerfiles.get('frontend'), /FROM nginx:1\.31-alpine3\.23-slim AS runtime/u);
  assert.match(composeService('caddy-edge'), /^    image: caddy:2\.11-alpine$/mu);
  assert.match(composeService('postgres'), /^    image: postgres:18\.4-alpine3\.24$/mu);
  assert.match(composeService('redis'), /^    image: redis:8\.6-alpine3\.23$/mu);
});

test('release publication pulls refreshed upstream bases', () => {
  assert.match(
    releaseWorkflow,
    /docker\/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a/u,
  );
  assert.match(releaseWorkflow, /^\s+pull: true$/mu);
  assert.match(releaseWorkflow, /cache-from: type=gha,scope=batch-backend/u);
  assert.match(releaseWorkflow, /cache-to: type=gha,mode=max,scope=batch-backend/u);
});

test('library-only orchestrator has no standalone image surface', () => {
  assert.equal(existsSync(new URL('packages/orchestrator/Dockerfile', root)), false);
  assert.equal(orchestratorPackage.scripts['docker:build'], undefined);
  assert.equal(orchestratorPackage.scripts['docker:run'], undefined);
});
