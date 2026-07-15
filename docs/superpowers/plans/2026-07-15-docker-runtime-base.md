# Docker Runtime Base and Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution is preferred
> because the Dockerfiles and their structural contract test form one tightly coupled change set.

**Goal:** Move repository-owned Node images to Debian 13 slim, modernize pnpm Docker caching and
deployment, constrain official infrastructure tags, and preserve the complete pull-based production
runtime contract.

**Architecture:** All Node build and runtime stages use `node:24-trixie-slim`, while nginx, Caddy,
PostgreSQL, and Redis retain controlled official Alpine variants. A focused Node structural test
locks Dockerfile, workspace, Compose, release-workflow, and retired-image contracts. Docker builds
use Corepack's committed pnpm version, lockfile-first fetch, BuildKit store caches, filtered offline
install, and pnpm 11 modern deployment before fresh local image smoke and broad validation.

**Tech Stack:** Docker BuildKit/buildx, Docker Compose, Node.js 24, Debian 13 Trixie slim, pnpm
11.10.0, TypeScript workspace packages, nginx, Caddy, PostgreSQL, Redis, GitHub Actions, Hadolint,
dclint, Node test runner.

## Global Constraints

- Implement the approved design in
  `docs/superpowers/specs/2026-07-15-docker-runtime-base-design.md` without reopening the base-image
  decision or performing an Alpine-versus-Debian A/B gate.
- Use `node:24-trixie-slim` explicitly for every Node build and runtime stage in the backend,
  frontend, and Telegram production Dockerfiles; do not use `node:24-slim`, Bookworm, Alpine Node,
  a full buildpack image, distroless, Chainguard, or a custom Node installation. Development
  Dockerfiles and Compose services are outside this migration.
- Build native dependencies and run them on the same Debian/glibc family.
- Keep nginx, Caddy, PostgreSQL, and Redis on the controlled Alpine tags approved in the design.
- Keep one backend image for API, batch worker, student-memory worker, and transcribe worker.
- Preserve non-root users, ports, commands, healthchecks, nginx Docker DNS behavior, prompt-gallery
  assets, migrations, schema baseline, `/app/tmp`, `/app/uploads`, and `.secrets` mounts.
- Do not change application behavior, DTOs, manifests, environment contracts, database schemas,
  migrations, service topology, or production data volumes.
- Do not add speculative Compose CPU/memory limits; resource budgeting is a separate evidence-based
  task.
- Do not update unrelated npm dependencies or reintroduce custom dependency/base pinning tools.
- Build and validate locally/CI only. Do not deploy or build images on the Lightsail VPS.
- Use Conventional Commits and deliver one `release:patch` PR.

## File and Responsibility Map

- `scripts/docker/production-image-contract.test.mjs` — structural source contract for production
  Dockerfiles, package deployment, Compose tags, release pulls, and retired orchestrator image.
- `packages/batch-backend/Dockerfile` — Debian backend build/runtime, cached pnpm install, modern
  deploy, FFmpeg runtime, assets, and writable paths.
- `packages/batch-frontend/Dockerfile` — Debian frontend builder and controlled rootless nginx
  runtime.
- `packages/telegram-ops-bot/Dockerfile` — Debian bot build/runtime and modern deploy.
- `pnpm-workspace.yaml` and `pnpm-lock.yaml` — injected workspace deployment and post-build sync
  policy, locked by pnpm 11.10.0.
- `packages/batch-backend/package.json` — runtime file allowlist.
- `packages/orchestrator/Dockerfile` and `packages/orchestrator/package.json` — obsolete standalone
  image and scripts to remove.
- `scripts/docker/run-hadolint.test.mjs` — generic discovery fixtures updated after orchestrator
  Dockerfile retirement.
- `docker-compose.prod.yml` — controlled official infrastructure tags only; app image refs and
  commands remain unchanged.
- `.github/workflows/release-on-merge.yml` — fresh upstream base resolution through `--pull`.
- `docs/backend-frontend/DEPLOYMENT.md` — canonical production image/base and validation workflow.
- `docs/operations/production-env-checklist.md` — operator-facing image policy and no-build-on-VPS
  reminder.
- `docs/reference/TESTING_GUIDELINES.md` — structural and runtime image validation lanes.

---

### Task 1: Move Node Images to Debian and Add Lockfile-First Caching

**Files:**

- Create: `scripts/docker/production-image-contract.test.mjs`
- Modify: `packages/batch-backend/Dockerfile`
- Modify: `packages/batch-frontend/Dockerfile`
- Modify: `packages/telegram-ops-bot/Dockerfile`

**Interfaces:**

- Consumes: root `packageManager` (`pnpm@11.10.0`), current workspace filters, and existing runtime
  commands/assets.
- Produces: three production Dockerfiles using Debian 13/glibc, Corepack-owned pnpm, cached fetch,
  and filtered offline install. Task 2 relies on the same build stages for modern deployment.

- [ ] **Step 1: Add RED structural tests for Node bases and dependency acquisition**

Create `scripts/docker/production-image-contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const dockerfiles = new Map([
  ['backend', read('packages/batch-backend/Dockerfile')],
  ['frontend', read('packages/batch-frontend/Dockerfile')],
  ['bot', read('packages/telegram-ops-bot/Dockerfile')],
]);

test('production application Node stages use Debian 13 slim and committed pnpm', () => {
  for (const [name, dockerfile] of dockerfiles) {
    assert.match(dockerfile, /FROM node:24-trixie-slim AS build/u, name);
    assert.doesNotMatch(dockerfile, /FROM node:[^\n]*alpine/u, name);
    assert.doesNotMatch(dockerfile, /corepack prepare|pnpm@10/u, name);
    assert.match(dockerfile, /RUN corepack enable/u, name);
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/docker/production-image-contract.test.mjs
```

Expected: FAIL because the three builders and two Node runtime stages still use Alpine, name pnpm
10, and lack lockfile-first fetch/offline install.

- [ ] **Step 3: Rewrite the backend Dockerfile with the Debian/cached-build structure**

Replace `packages/batch-backend/Dockerfile` with:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS build

ENV CI=true

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY .env.example ./.env.example

RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm fetch --frozen-lockfile

COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete
RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm --filter @esl-pipeline/batch-backend... install --offline --frozen-lockfile
RUN pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-backend... run build \
    && pnpm --filter @esl-pipeline/batch-backend deploy --legacy --prod /app/deployed

FROM node:24-trixie-slim AS runtime

ENV NODE_ENV=production \
    CI=true \
    PIPELINE_CWD=/app \
    FILESYSTEM_UPLOAD_DIR=/app/uploads

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=node:node /app/deployed/ ./
COPY --chown=node:node docs/prompt-gallery ./docs/prompt-gallery

RUN mkdir -p /app/tmp /app/uploads \
    && chown -R node:node /app/tmp /app/uploads

EXPOSE 8080

USER node

CMD ["node", "dist/transport/http-server.js"]
```

Keep `--legacy` temporarily in Task 1; Task 2 removes it only after workspace injection and lockfile
state are committed.

- [ ] **Step 4: Rewrite the frontend Dockerfile with Debian build and controlled nginx runtime**

Replace `packages/batch-frontend/Dockerfile` with:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS build

ENV CI=true

RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm fetch --frozen-lockfile

COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete
RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm --filter @esl-pipeline/batch-frontend... install --offline --frozen-lockfile
RUN pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-frontend... run build

FROM nginx:1.31-alpine3.23-slim AS runtime

RUN mkdir -p /tmp/nginx \
    && chown -R nginx:nginx /tmp/nginx /var/cache/nginx /usr/share/nginx/html

COPY packages/batch-frontend/nginx-rootless.conf /etc/nginx/nginx.conf
COPY packages/batch-frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/packages/batch-frontend/dist /usr/share/nginx/html

EXPOSE 8080

USER nginx
```

- [ ] **Step 5: Rewrite the bot Dockerfile with Debian build/runtime and cached install**

Replace `packages/telegram-ops-bot/Dockerfile` with:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS build

ENV CI=true

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm fetch --frozen-lockfile

COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete
RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm --filter @esl-pipeline/telegram-ops-bot... install --offline --frozen-lockfile
RUN pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/telegram-ops-bot... run build \
    && pnpm --filter @esl-pipeline/telegram-ops-bot deploy --legacy --prod /app/deployed

FROM node:24-trixie-slim AS runtime

ENV NODE_ENV=production \
    CI=true

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=node:node /app/deployed/ ./

USER node

CMD ["node", "dist/src/index.js"]
```

- [ ] **Step 6: Run structural and Docker lint checks and verify GREEN**

Run:

```bash
node --test scripts/docker/production-image-contract.test.mjs
pnpm docker:lint
```

Expected: PASS. Hadolint accepts the scoped `DL3008` exceptions and continues checking every other
rule.

- [ ] **Step 7: Commit the Debian and caching migration**

```bash
git add scripts/docker/production-image-contract.test.mjs packages/batch-backend/Dockerfile packages/batch-frontend/Dockerfile packages/telegram-ops-bot/Dockerfile
git commit -m "build(docker): move node images to Debian"
```

---

### Task 2: Enable Modern pnpm Deployment and Trim the Backend Payload

**Files:**

- Modify: `scripts/docker/production-image-contract.test.mjs`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/batch-backend/package.json`
- Modify: `packages/batch-backend/Dockerfile`
- Modify: `packages/telegram-ops-bot/Dockerfile`

**Interfaces:**

- Consumes: Task 1's filtered offline installs and build stages.
- Produces: injected workspace packages synchronized after `build`, dedicated deployment lockfiles,
  and runtime packages without backend source/tests. Task 4 validates the portable results.

- [ ] **Step 1: Extend the structural test with RED modern-deploy assertions**

Append to `scripts/docker/production-image-contract.test.mjs`:

```js
const workspace = read('pnpm-workspace.yaml');
const backendPackage = JSON.parse(read('packages/batch-backend/package.json'));

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

test('backend deployment includes only runtime-owned package files', () => {
  assert.deepEqual(backendPackage.files, ['dist', 'migrations', 'schema.sql']);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/docker/production-image-contract.test.mjs
```

Expected: FAIL because workspace injection/synchronization and the backend allowlist are absent and
the backend/bot still use `deploy --legacy`.

- [ ] **Step 3: Enable pnpm's documented monorepo deployment settings**

Change `pnpm-workspace.yaml` to retain the package globs and add root settings:

```yaml
packages:
  - packages/*
  - packages/orchestrator/examples/*

injectWorkspacePackages: true
syncInjectedDepsAfterScripts:
  - build
```

Preserve the existing `storeDir`, overrides, and `allowBuilds` entries exactly. The Docker cache
mount in Task 1 is deliberately coupled to the committed `.pnpm-store/v11` location.

Run the repository-pinned package manager to update lockfile settings:

```bash
corepack pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` records the injected-workspace setting without dependency-version
upgrades. Inspect `git diff -- pnpm-lock.yaml`; dependency resolution/version churn is not accepted
in this task.

- [ ] **Step 4: Add the backend runtime file allowlist**

Add after `types` in `packages/batch-backend/package.json`:

```json
"files": [
  "dist",
  "migrations",
  "schema.sql"
],
```

Do not add `src`, `tests`, `tmp`, `uploads`, Dockerfiles, TypeScript configs, or docs. The runtime
Dockerfile already creates writable directories and copies prompt-gallery assets explicitly.

- [ ] **Step 5: Switch backend and bot to modern deploy**

In `packages/batch-backend/Dockerfile`, replace:

```dockerfile
pnpm --filter @esl-pipeline/batch-backend deploy --legacy --prod /app/deployed
```

with:

```dockerfile
pnpm --filter @esl-pipeline/batch-backend deploy --prod /app/deployed
```

In `packages/telegram-ops-bot/Dockerfile`, replace:

```dockerfile
pnpm --filter @esl-pipeline/telegram-ops-bot deploy --legacy --prod /app/deployed
```

with:

```dockerfile
pnpm --filter @esl-pipeline/telegram-ops-bot deploy --prod /app/deployed
```

- [ ] **Step 6: Verify workspace installs and structural contracts**

Run:

```bash
corepack pnpm install --frozen-lockfile
node --test scripts/docker/production-image-contract.test.mjs
pnpm test:tooling
```

Expected: PASS. Local install succeeds with injected packages, the complete script test lane remains
green, and the production Dockerfiles contain no legacy deploy path.

- [ ] **Step 7: Commit modern deployment**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/batch-backend/package.json packages/batch-backend/Dockerfile packages/telegram-ops-bot/Dockerfile scripts/docker/production-image-contract.test.mjs
git commit -m "build(docker): modernize workspace deployment"
```

---

### Task 3: Constrain Infrastructure Tags, Pull Fresh Bases, and Retire the Orchestrator Image

**Files:**

- Modify: `scripts/docker/production-image-contract.test.mjs`
- Modify: `docker-compose.prod.yml`
- Modify: `.github/workflows/release-on-merge.yml`
- Modify: `packages/orchestrator/package.json`
- Delete: `packages/orchestrator/Dockerfile`
- Modify: `scripts/docker/run-hadolint.test.mjs`

**Interfaces:**

- Consumes: Task 1's controlled nginx runtime and existing pull-based release loop.
- Produces: controlled infrastructure tags, release base refresh, and one truthful set of published
  images. No service commands, data volumes, or release bundle names change.

- [ ] **Step 1: Extend the structural test with RED Compose/release/retirement assertions**

First replace the Task 1 `node:fs` import with:

```js
import { existsSync, readFileSync } from 'node:fs';
```

Then append:

```js
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

test('production infrastructure stays on controlled official image lines', () => {
  assert.match(dockerfiles.get('frontend'), /FROM nginx:1\.31-alpine3\.23-slim AS runtime/u);
  assert.match(composeService('caddy-edge'), /^    image: caddy:2\.11-alpine$/mu);
  assert.match(composeService('postgres'), /^    image: postgres:18\.4-alpine3\.24$/mu);
  assert.match(composeService('redis'), /^    image: redis:8\.6-alpine3\.23$/mu);
});

test('release publication pulls refreshed upstream bases', () => {
  const buildStart = releaseWorkflow.indexOf('docker buildx build');
  const publishEnd = releaseWorkflow.indexOf(' .', buildStart);
  assert.notEqual(buildStart, -1);
  assert.notEqual(publishEnd, -1);
  assert.match(releaseWorkflow.slice(buildStart, publishEnd), /^\s*--pull \\$/mu);
});

test('library-only orchestrator has no standalone image surface', () => {
  assert.equal(existsSync(new URL('packages/orchestrator/Dockerfile', root)), false);
  assert.equal(orchestratorPackage.scripts['docker:build'], undefined);
  assert.equal(orchestratorPackage.scripts['docker:run'], undefined);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/docker/production-image-contract.test.mjs
```

Expected: FAIL on current Caddy/PostgreSQL/Redis tags, absent `--pull`, and the existing orchestrator
Dockerfile/scripts.

- [ ] **Step 3: Constrain production infrastructure tags without changing services**

In `docker-compose.prod.yml`, make only these replacements:

```yaml
image: caddy:2.11-alpine
image: postgres:18.4-alpine3.24
image: redis:8.6-alpine3.23
```

Do not change service names, profiles, commands, healthchecks, environment, mounts, ports, restart
policies, or volumes.

- [ ] **Step 4: Add fresh-base resolution to the release build loop**

In `.github/workflows/release-on-merge.yml`, add `--pull` to the existing `docker buildx build`
arguments before cache/tag arguments:

```bash
docker buildx build \
  "${common_args[@]}" \
  --pull \
  --cache-from "type=gha,scope=${name}" \
  --cache-to "type=gha,mode=max,scope=${name}" \
  --file "$dockerfile" \
  --tag "$sha_image" \
  --tag "$version_image" \
  --push \
  .
```

Keep three images, their SHA/version tags, cache scopes, release dependency, and publish condition
unchanged.

- [ ] **Step 5: Remove the obsolete orchestrator image surface**

Delete `packages/orchestrator/Dockerfile`. Remove only these keys from
`packages/orchestrator/package.json`:

```json
"docker:build": "cd ../.. && docker build -f packages/orchestrator/Dockerfile -t esl-pipeline/orchestrator:local .",
"docker:run": "docker run --rm esl-pipeline/orchestrator:local",
```

Keep all normal orchestrator build, type, test, prepack, and package-boundary scripts.

- [ ] **Step 6: Make Hadolint tests generic to the remaining Dockerfiles**

In `scripts/docker/run-hadolint.test.mjs`, replace orchestrator-specific fixture paths with existing
remaining paths. Use:

```text
packages/batch-frontend/Dockerfile
packages/batch-backend/Dockerfile.dev
```

Update the parsing, invocation, forwarded suffix, and summary expectations accordingly. Do not
hardcode the complete repository Dockerfile inventory; the runner must continue discovering every
tracked `Dockerfile*` through Git.

- [ ] **Step 7: Verify Compose, release, and Docker lint contracts**

Set the documented non-secret placeholders in the current shell, then run:

```powershell
$env:CADDY_PUBLIC_HOSTNAME = 'alpha.example.com'
$env:CADDY_ACME_EMAIL = 'ops@example.com'

node --test scripts/docker/production-image-contract.test.mjs scripts/docker/run-hadolint.test.mjs
pnpm docker:prod:config
pnpm docker:prod:edge:config
pnpm docker:prod:ops-bot:config
pnpm docker:lint
```

Expected: all commands PASS, rendered Compose retains the same services/commands/volumes, and
Hadolint checks every remaining tracked Dockerfile.

- [ ] **Step 8: Commit release and image-source hardening**

```bash
git add docker-compose.prod.yml .github/workflows/release-on-merge.yml packages/orchestrator/package.json packages/orchestrator/Dockerfile scripts/docker/run-hadolint.test.mjs scripts/docker/production-image-contract.test.mjs
git commit -m "ci(release): harden production image inputs"
```

---

### Task 4: Build and Smoke the Complete Production Image Bundle

**Files:**

- Verify only; do not commit generated images, logs, or temporary files.

**Interfaces:**

- Consumes: Tasks 1-3's three production Dockerfiles, modern deploy payloads, runtime assets, and
  controlled Compose/release contracts.
- Produces: fresh local evidence that the exact production images build and contain every required
  runtime entrypoint/asset on Debian. Documentation in Task 5 records the durable procedure, not the
  transient size values.

- [ ] **Step 1: Build all three production images once with fresh upstream bases**

Run:

```powershell
docker buildx build --platform linux/amd64 --pull --load --file packages/batch-backend/Dockerfile --tag esl-pipeline/verify-backend:debian .
docker buildx build --platform linux/amd64 --pull --load --file packages/batch-frontend/Dockerfile --tag esl-pipeline/verify-frontend:debian .
docker buildx build --platform linux/amd64 --pull --load --file packages/telegram-ops-bot/Dockerfile --tag esl-pipeline/verify-bot:debian .
```

Expected: all three builds succeed. Build logs use pnpm 11.10.0, modern deploy has no `--legacy`
warning/path, and native dependencies compile for glibc.

- [ ] **Step 2: Verify backend runtime assets, native imports, permissions, and exclusions**

Run:

```powershell
$backendSmoke = @'
set -eu
node --version
ffmpeg -version >/dev/null
node --input-type=module -e "await import('bcrypt'); await import('fastify'); await import('pg')"
test -f dist/transport/http-server.js
test -f dist/transport/worker-runner.js
test -f dist/transport/student-memory-worker.js
test -f dist/transport/transcribe-worker.js
test -f dist/tools/migrate-db.js
test -f dist/tools/bootstrap-prompt-assets.js
test -f dist/tools/smoke-s3-storage.js
test -d migrations
test -f schema.sql
test -f docs/prompt-gallery/templates/hw_prompt_definitive.md
test -w tmp
test -w uploads
test ! -e src
test ! -e tests
test ! -e Dockerfile
test ! -e tsconfig.json
test ! -e .pnpm-store
test ! -e /pnpm
! command -v g++ >/dev/null 2>&1
! command -v make >/dev/null 2>&1
'@
docker run --rm --entrypoint sh esl-pipeline/verify-backend:debian -lc $backendSmoke
```

Expected: exit 0 as the non-root `node` user. Confirm separately:

```powershell
(docker image inspect esl-pipeline/verify-backend:debian | ConvertFrom-Json)[0].Config.User
```

Expected: `node`.

- [ ] **Step 3: Verify bot runtime payload and user**

Run:

```powershell
$botSmoke = @'
set -eu
node --check dist/src/index.js
node --input-type=module -e "await import('pg'); await import('@esl-pipeline/shared-infrastructure')"
test ! -e src
test ! -e tests
test ! -e .pnpm-store
test ! -e /pnpm
! command -v g++ >/dev/null 2>&1
! command -v make >/dev/null 2>&1
'@
docker run --rm --entrypoint sh esl-pipeline/verify-bot:debian -lc $botSmoke
(docker image inspect esl-pipeline/verify-bot:debian | ConvertFrom-Json)[0].Config.User
```

Expected: exit 0 and user `node`.

- [ ] **Step 4: Verify rootless frontend startup and proxy behavior**

Run:

```powershell
docker run --rm --entrypoint nginx esl-pipeline/verify-frontend:debian -t
$name = "esl-pipeline-verify-frontend-$([guid]::NewGuid().ToString('N'))"
$containerId = $null
try {
  $containerId = (docker run --detach --name $name --publish 127.0.0.1::8080 esl-pipeline/verify-frontend:debian).Trim()
  if ($LASTEXITCODE -ne 0 -or !$containerId) { throw 'frontend container did not start' }
  $binding = (docker port $containerId 8080/tcp).Trim()
  $port = ($binding -split ':')[-1]
  $ready = $false
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/" | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (!$ready) { throw 'frontend did not become ready' }
  $user = (docker image inspect esl-pipeline/verify-frontend:debian | ConvertFrom-Json)[0].Config.User
  if ($user -ne 'nginx') { throw "unexpected frontend user: $user" }
} finally {
  if ($containerId) { docker rm --force $containerId 2>$null }
}
```

Expected: nginx configuration passes, `/` responds successfully, and the image user is `nginx`.
The existing `/api/` resolver/proxy assertions remain covered by nginx configuration and repository
tests; no backend container is needed for this static startup smoke.

- [ ] **Step 5: Record comparative image evidence without creating a contract**

Run:

```powershell
docker images --format "{{.Repository}}:{{.Tag}}`t{{.Size}}" | Select-String 'esl-pipeline/verify-'
docker history --format "{{.Size}}`t{{.CreatedBy}}" esl-pipeline/verify-backend:debian
```

Expected: evidence is available for the PR description/review. Do not add exact byte/size thresholds
to tests or docs; upstream base and dependency refreshes legitimately change them.

- [ ] **Step 6: Remove local verification images**

Run:

```powershell
docker image rm esl-pipeline/verify-backend:debian esl-pipeline/verify-frontend:debian esl-pipeline/verify-bot:debian
```

Expected: temporary verification tags are removed and no repository files were generated.

---

### Task 5: Synchronize Deployment and Testing Documentation

**Files:**

- Modify: `docs/backend-frontend/DEPLOYMENT.md`
- Modify: `docs/operations/production-env-checklist.md`
- Modify: `docs/reference/TESTING_GUIDELINES.md`

**Interfaces:**

- Consumes: Tasks 1-4's final image/base policy and verified commands.
- Produces: concise durable routing for maintainers/operators; no runtime behavior changes.

- [ ] **Step 1: Document the production image policy in the deployment runbook**

Add a concise `Production Image Bases` subsection beside the existing GHCR/release-image section in
`docs/backend-frontend/DEPLOYMENT.md`:

```markdown
### Production image bases

Repository-owned Node build and runtime stages use `node:24-trixie-slim`. Build and runtime stages
stay on the same Debian/glibc family so native dependencies are never compiled against musl and run
against glibc. The frontend runtime remains rootless nginx on the controlled Alpine-slim line;
Caddy, PostgreSQL, and Redis remain on their controlled official Alpine variants.

Release builds use `--pull` and controlled major/minor plus distribution tags so eligible Node,
Debian, and infrastructure patch/security refreshes arrive through a normal merged release. Do not
build production images on the Lightsail VPS, introduce a second worker image, or change the
PostgreSQL base family without a separate data/collation migration design.
```

Reference the three Dockerfiles and production Compose rather than copying current transient image
sizes.

- [ ] **Step 2: Add operator-facing image constraints to the production checklist**

Under `Deployment Images and State` in `docs/operations/production-env-checklist.md`, add:

```markdown
The three GHCR application images are CI-built from Debian 13 slim Node stages (backend and bot)
plus the controlled rootless nginx runtime (frontend). The VPS pulls those reviewed SHA tags; it
does not run `docker build`, pnpm install/build, or image mutation commands. PostgreSQL and Redis
keep their existing official Alpine families and persistent volumes.
```

Do not add deployment commands beyond the existing manual operator flow.

- [ ] **Step 3: Document the focused structural and runtime validation lanes**

In the Docker-trigger section of `docs/reference/TESTING_GUIDELINES.md`, add:

```markdown
- `node --test scripts/docker/production-image-contract.test.mjs` locks production bases, modern
  pnpm deployment, Compose image lines, release `--pull`, and orchestrator-image retirement.
- `pnpm docker:lint` remains the portable all-Dockerfile plus Compose lint lane.
- Base, packaging, or runtime-asset changes require fresh local builds of backend, frontend, and bot
  plus bounded non-root/runtime-asset smoke before `check:pre-pr`. Image-size output is review
  evidence, not a fixed test threshold.
```

- [ ] **Step 4: Format and validate documentation**

Run:

```bash
pnpm format:write
pnpm format
pnpm docs:generate:indexes
pnpm docs:check
git diff --check
```

Expected: PASS and generated indexes remain synchronized.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/backend-frontend/DEPLOYMENT.md docs/operations/production-env-checklist.md docs/reference/TESTING_GUIDELINES.md
git commit -m "docs(deploy): document production image policy"
```

---

### Task 6: Final Combined Validation and PR Preparation

**Files:**

- Verify the complete branch; modify only mechanical formatter output if required.

- [ ] **Step 1: Run the complete focused Docker/tooling evidence**

```bash
node --test scripts/docker/production-image-contract.test.mjs scripts/docker/run-hadolint.test.mjs
pnpm test:tooling
pnpm docker:lint
pnpm docker:prod:config
pnpm docs:check
pnpm audit --prod
```

Expected: PASS, with no known production dependency vulnerabilities.

- [ ] **Step 2: Run repository hygiene and affected validation**

```bash
pnpm format
pnpm run lint:repo-hygiene
pnpm --silent run check:fast:agent
```

Expected: PASS. If the agent lane reports an artifact path, inspect that artifact before rerunning a
raw lane.

- [ ] **Step 3: Run the broad pre-PR gate**

```bash
pnpm check:pre-pr
```

Expected: PASS. This is a cross-cutting Docker/workspace/release branch, so the broad local gate is
required even if affected validation passes.

- [ ] **Step 4: Review the final diff against the approved design**

```bash
git status --short --branch
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- packages/batch-backend/Dockerfile packages/batch-frontend/Dockerfile packages/telegram-ops-bot/Dockerfile pnpm-workspace.yaml pnpm-lock.yaml packages/batch-backend/package.json packages/orchestrator docker-compose.prod.yml .github/workflows/release-on-merge.yml scripts/docker docs/backend-frontend/DEPLOYMENT.md docs/operations/production-env-checklist.md docs/reference/TESTING_GUIDELINES.md
```

Expected: only approved base, packaging, release, retired-image, test, and documentation changes.
There must be no environment/contract/database/migration change and no generated local artifacts.

- [ ] **Step 5: Prepare one patch-release PR without deployment**

Use the exact PR template sections and list only commands actually run. The risk section must call
out the Node libc/base migration, modern pnpm deployment, controlled Redis/Caddy tag movement, and
preserved PostgreSQL image family/data volume. Apply exactly one `release:patch` label.

Do not deploy, merge, or mutate the VPS. Hosted validation must include the normal static,
integration, DB/worker, Telegram compose-smoke, release-label, and aggregate gates. Image publication
runs only after a later merge/release commit.
