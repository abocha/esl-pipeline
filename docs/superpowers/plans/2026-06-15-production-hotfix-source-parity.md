# Production Hotfix Source Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every live production hotfix from Chunk 2 in committed source before production services are recreated.

**Architecture:** Treat this as a source-parity hardening pass, not a deployment. Existing source already covers the frontend nginx resolver, profile revision query/body aliases, and Caddy edge recreate/config assertions; this plan adds regression coverage and implementation for the missing Docker runtime directory and Google credential mount guarantees.

**Tech Stack:** Docker Compose production config, backend Dockerfile, Node `node:test` config regression tests, active deployment docs.

---

## Current Source Evidence

- `packages/batch-frontend/nginx.conf` already includes `resolver 127.0.0.11 ipv6=off valid=30s;`.
- `packages/batch-frontend/src/utils/api.profile-routes.test.ts` already verifies profile revision APIs use query/body `profileId` aliases for path-like profile IDs.
- `packages/batch-backend/src/transport/extended-routes/profiles-templates-routes.ts` already accepts `profileId` from query/body aliases for revision list/detail/save/restore/activate routes while preserving legacy path routes.
- `scripts/deploy/deploy-prod-images.sh` already force-recreates `caddy-edge` in edge mode and asserts the running Caddyfile contains `reverse_proxy batch-frontend:8080`.
- `scripts/deploy/deploy-prod-images.test.mjs` already covers the Caddy force-recreate and upstream assertions.
- `packages/batch-backend/Dockerfile` is missing the `/app/tmp` and `/app/uploads` directory creation/chown step before `USER node`.
- `docker-compose.prod.yml` is missing the read-only `.secrets` mount and explicit `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json` env on backend-image services that may touch Google STT/TTS.

### Task 1: Regression Tests for Dockerfile and Compose Hotfix Parity

**Files:**

- Modify: `scripts/docker/prod-compose-config.test.mjs`
- Create: `scripts/docker/backend-dockerfile-runtime.test.mjs`

- [x] **Step 1: Add a failing Compose regression test for Google credentials**

Add this test to `scripts/docker/prod-compose-config.test.mjs`:

```js
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

    const secretsMount = service.volumes.find(
      (volume) => volume.source.endsWith('/.secrets') && volume.target === '/app/secrets',
    );
    assert.ok(secretsMount, `${serviceName} should mount the server-local .secrets directory`);
    assert.equal(secretsMount.read_only, true, `${serviceName} .secrets mount should be read-only`);
  }
});
```

- [x] **Step 2: Run the Compose test and verify it fails for the missing mount/env**

Run:

```bash
node --test scripts/docker/prod-compose-config.test.mjs
```

Expected: FAIL with an assertion mentioning `GOOGLE_APPLICATION_CREDENTIALS` or `.secrets`.

- [x] **Step 3: Add a failing Dockerfile regression test for writable runtime dirs**

Create `scripts/docker/backend-dockerfile-runtime.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(
  new URL('../../packages/batch-backend/Dockerfile', import.meta.url),
  'utf8',
);

test('backend runtime image creates writable tmp and uploads before dropping privileges', () => {
  const mkdirIndex = dockerfile.indexOf('mkdir -p /app/tmp /app/uploads');
  const chownIndex = dockerfile.indexOf('chown -R node:node /app/tmp /app/uploads');
  const userNodeIndex = dockerfile.indexOf('USER node');

  assert.notEqual(mkdirIndex, -1, 'Dockerfile should create /app/tmp and /app/uploads');
  assert.notEqual(chownIndex, -1, 'Dockerfile should chown /app/tmp and /app/uploads to node');
  assert.notEqual(userNodeIndex, -1, 'Dockerfile should drop privileges with USER node');
  assert.ok(mkdirIndex < userNodeIndex, 'runtime dirs must be created before USER node');
  assert.ok(chownIndex < userNodeIndex, 'runtime dirs must be chowned before USER node');
});
```

- [x] **Step 4: Run the Dockerfile test and verify it fails for the missing mkdir/chown**

Run:

```bash
node --test scripts/docker/backend-dockerfile-runtime.test.mjs
```

Expected: FAIL with `Dockerfile should create /app/tmp and /app/uploads`.

### Task 2: Implement Source Parity for Missing Hotfixes

**Files:**

- Modify: `packages/batch-backend/Dockerfile`
- Modify: `docker-compose.prod.yml`

- [x] **Step 1: Create writable backend runtime dirs before `USER node`**

In `packages/batch-backend/Dockerfile`, after the runtime `COPY` lines and before `EXPOSE 8080`, add:

```dockerfile
RUN mkdir -p /app/tmp /app/uploads \
    && chown -R node:node /app/tmp /app/uploads
```

- [x] **Step 2: Add the read-only `.secrets` mount and Google credential env to backend-image services**

In `docker-compose.prod.yml`, apply this volume mount to `batch-backend`, `batch-worker`, `student-memory-worker`, and `transcribe-worker`:

```yaml
- type: bind
  source: ./.secrets
  target: /app/secrets
  read_only: true
  bind:
    create_host_path: false
```

Add this environment entry to the same services:

```yaml
GOOGLE_APPLICATION_CREDENTIALS: /app/secrets/google-service-account.json
```

Keep `.env.batch-backend` as the server-local env source and do not commit any real credentials.

- [x] **Step 3: Run targeted tests and verify they pass**

Run:

```bash
node --test scripts/docker/backend-dockerfile-runtime.test.mjs
node --test scripts/docker/prod-compose-config.test.mjs
pnpm docker:prod:config
```

Expected: all commands PASS.

### Task 3: Update Docs and Chunk Evidence

**Files:**

- Modify: `docs/plans/2026-06-15-production-readiness-restart-chunks.md`
- Modify: `docs/backend-frontend/DEPLOYMENT.md`
- Modify: `docs/operations/production-env-checklist.md`
- Modify: `docs/playbooks/RESTART_TOMORROW.md`

- [x] **Step 1: Record source evidence in the chunk map**

Under Chunk 2, add a short source-evidence list that marks already-present items and the new Docker/Compose tests.

- [x] **Step 2: Clarify deployment docs for Google credential mount**

Update deployment/runtime docs to state that backend-image services mount server-local `.secrets` read-only at `/app/secrets` and use `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json`.

- [x] **Step 3: Run docs validation**

Run:

```bash
pnpm docs:generate:indexes
pnpm docs:check
```

Expected: both commands PASS.

### Task 4: Final Validation

**Files:**

- Verify all modified files.

- [x] **Step 1: Run the affected agent lane**

Run:

```bash
pnpm --silent run check:fast:agent
```

Expected: PASS.

- [x] **Step 2: Check formatting and whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [x] **Step 3: Audit Chunk 2 completion**

Confirm each Chunk 2 acceptance gate has current evidence:

- every hotfix has source evidence or an "already present" note;
- production Compose remains pull-based and SHA-image driven;
- deployment smoke covers edge routing, backend health, worker logs, and image refs.
