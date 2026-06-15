# Production Student-Memory Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `student-memory-worker` in production Compose so canonical lesson-memory, homework-memory, and snapshot jobs are consumed in production.

**Architecture:** Reuse the existing backend runtime image and existing `packages/batch-backend/src/transport/student-memory-worker.ts` entrypoint. Add a dedicated production Compose service wired like the other backend workers, then document the runtime and smoke evidence commands that prove it is running.

**Tech Stack:** Docker Compose, Node.js backend runtime image, BullMQ/Redis student-memory queue, Postgres, repo docs validation.

---

## File Structure

- Create: `scripts/docker/prod-compose-config.test.mjs`
  - Verifies production Compose renders a `student-memory-worker` service with the intended image, environment, dependency, and command contract.
- Modify: `docker-compose.prod.yml`
  - Adds `student-memory-worker` using `BATCH_BACKEND_IMAGE`, `.env.batch-backend`, Postgres/Redis dependencies, a distinct `PG_APPLICATION_NAME`, and `node dist/transport/student-memory-worker.js`.
- Modify: `docs/backend-frontend/DEPLOYMENT.md`
  - Names the worker in the production runtime model and adds smoke commands for status/log evidence.
- Modify: `docs/backend-frontend/BATCH_SYSTEM.md`
  - States that the dedicated production worker consumes canonical student-memory jobs.
- Modify: `docs/operations/student-memory-replay-backfill.md`
  - Clarifies that replay/backfill requests require the dedicated worker in Compose-managed production.
- Modify: `docs/operations/production-env-checklist.md`
  - Adds `student-memory-worker` to host-level and smoke verification checklists.
- Modify/generated: `docs/generated/*.md`
  - Regenerate after documentation changes.

### Task 1: Compose Contract Test

**Files:**

- Create: `scripts/docker/prod-compose-config.test.mjs`

- [x] **Step 1: Write the failing test**

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --test scripts/docker/prod-compose-config.test.mjs
```

Expected: FAIL with `student-memory-worker service should be present`.

### Task 2: Add Production Compose Service

**Files:**

- Modify: `docker-compose.prod.yml`
- Test: `scripts/docker/prod-compose-config.test.mjs`

- [x] **Step 1: Add the worker service**

Insert this service near the other backend-image workers:

```yaml
student-memory-worker:
  image: ${BATCH_BACKEND_IMAGE:?Set BATCH_BACKEND_IMAGE to a GHCR image reference tagged with the deployed Git SHA}
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_started
  volumes:
    - type: bind
      source: ./uploads
      target: /app/uploads
      bind:
        create_host_path: false
  environment:
    NODE_ENV: production
    PIPELINE_CWD: /app
    FILESYSTEM_UPLOAD_DIR: /app/uploads
    PG_APPLICATION_NAME: esl-pipeline-student-memory-worker
    PG_POOL_MAX: '4'
  env_file:
    - .env.batch-backend
  command: ['node', 'dist/transport/student-memory-worker.js']
  restart: unless-stopped
```

- [x] **Step 2: Run test to verify it passes**

Run:

```bash
node --test scripts/docker/prod-compose-config.test.mjs
```

Expected: PASS.

- [x] **Step 3: Run production Compose config validation**

Run:

```bash
pnpm docker:prod:config
```

Expected: exit 0.

### Task 3: Runtime Documentation and Smoke Evidence

**Files:**

- Modify: `docs/backend-frontend/DEPLOYMENT.md`
- Modify: `docs/backend-frontend/BATCH_SYSTEM.md`
- Modify: `docs/operations/student-memory-replay-backfill.md`
- Modify: `docs/operations/production-env-checklist.md`

- [x] **Step 1: Update deployment runtime docs**

Document that default production Compose starts `batch-worker`, `transcribe-worker`, and `student-memory-worker`, and that post-deploy smoke should include:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  ps student-memory-worker
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  logs --tail=120 student-memory-worker
```

- [x] **Step 2: Update student-memory replay docs**

State that Compose-managed production processes replay/backfill requests asynchronously through `student-memory-worker`, and the worker logs are part of replay verification.

- [x] **Step 3: Update runtime checklists**

Add `student-memory-worker` anywhere production host checks currently list `batch-worker` and `transcribe-worker`.

### Task 4: Final Validation

**Files:**

- Modify/generated: `docs/generated/*.md`

- [x] **Step 1: Regenerate docs indexes**

Run:

```bash
pnpm docs:generate:indexes
```

Expected: exit 0.

- [x] **Step 2: Run docs check**

Run:

```bash
pnpm docs:check
```

Expected: exit 0.

- [x] **Step 3: Run affected agent check**

Run:

```bash
pnpm --silent run check:fast:agent
```

Expected: exit 0. If this selects a broader lane because `docker-compose.prod.yml` changed, read the artifact before rerunning any raw command.

- [x] **Step 4: Verify completion against Chunk 1**

Confirm:

- `docker-compose.prod.yml` contains `student-memory-worker`.
- `pnpm docker:prod:config` passes.
- docs name the worker in production runtime and smoke verification.
- docs explain replay/backfill worker verification.
- no P1/P2 UX chunks were implemented in this branch.

## Completion Evidence

Captured on 2026-06-15:

```bash
node --test scripts/docker/prod-compose-config.test.mjs
pnpm docker:prod:config
pnpm docs:generate:indexes
pnpm docs:check
pnpm --silent run check:fast:agent
pnpm exec prettier --check docker-compose.prod.yml docs/backend-frontend/BATCH_SYSTEM.md docs/backend-frontend/DEPLOYMENT.md docs/generated/backend-route-index.md docs/generated/env-surface-index.md docs/generated/package-readme-index.md docs/generated/plans-index.md docs/operations/production-env-checklist.md docs/operations/student-memory-replay-backfill.md docs/plans/2026-06-15-production-readiness-restart-chunks.md docs/plans/README.md docs/playbooks/RESTART_TOMORROW.md docs/superpowers/plans/2026-06-15-production-student-memory-worker.md
git diff --check
```

Notes:

- The test first failed with `student-memory-worker service should be present`, then passed after
  adding the production Compose service.
- `check:fast:agent` passed after formatting and service-order fixes.
- `docs:generate:indexes` rewrites generated docs in compact table form, so generated indexes were
  formatted again after the affected lane and checked with Prettier.
