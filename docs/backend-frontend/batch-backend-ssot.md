# @esl-pipeline/batch-backend – Architecture and Design SSOT

This document is the authoritative single source of truth (SSOT) for the [`@esl-pipeline/batch-backend`](packages/batch-backend/package.json) package. It describes the intended and implemented architecture, responsibilities, and constraints. Any substantial changes to this package MUST be reflected here.

All code references use clickable notation, for example [`submitJob.declaration()`](packages/batch-backend/src/application/submit-job.ts:21).

---

## 1. Overview and Goals

### 1.1 Purpose

`@esl-pipeline/batch-backend` provides a production-ready backend for executing ESL pipeline jobs asynchronously. It:

- Exposes a simple HTTP API to submit ESL jobs and query status.
- Executes jobs asynchronously via BullMQ workers backed by Redis.
- Persists job metadata and outcomes in Postgres.
- Integrates [`@esl-pipeline/orchestrator`](packages/orchestrator/src/index.ts) as the canonical engine for assignment processing.
- Is containerization-friendly and driven by environment configuration.

### 1.2 Primary Use Cases

- Backend services that need to:
  - Submit ESL pipeline runs for Markdown lessons.
  - Track asynchronous status of processing.
  - Run jobs at scale across multiple workers.
- Platform/SRE teams needing a standard, observable batch execution surface around the orchestrator.

### 1.3 Non-Goals and Assumptions

Non-goals:

- Not a generic workflow/DAG engine.
- Not responsible for:
  - Implementing user auth or fine-grained RBAC.
  - Managing secrets; assumes external secret management.
  - Providing multi-tenant isolation beyond what upstream callers enforce.
- Not exposing a public NPM API for arbitrary consumers; it is primarily an internal service within this monorepo.

Assumptions:

- Node.js 24.x, pnpm, Docker as per repo standards.
- Postgres, Redis, MinIO/S3, and other infra are provisioned and reachable when enabled.
- `@esl-pipeline/orchestrator` is the source of truth for pipeline semantics.

---

## 2. Architectural Context

### 2.1 Role in the Ecosystem

`batch-backend` is a dedicated batch execution service that:

- Wraps the orchestrator in a queue/worker pattern.
- Uses infra services (Postgres, Redis, MinIO/S3) via small adapters.
- Provides a stable HTTP/queue API to other internal services.

It complements:

- [`packages/orchestrator`](packages/orchestrator) (pipeline engine).
- Other `@esl-pipeline/*` packages (validator, extractor, Notion integration, TTS, uploader).

### 2.2 External Dependencies and Patterns

- Postgres:
  - Durable store for job metadata.
  - Accessed via [`createPgPool.declaration()`](packages/batch-backend/src/infrastructure/db.ts:15) and [`withPgClient.declaration()`](packages/batch-backend/src/infrastructure/db.ts:40).
- Redis:
  - Backing store for BullMQ.
  - Created via [`createRedisClient.declaration()`](packages/batch-backend/src/infrastructure/redis.ts:14).
- BullMQ:
  - Job queue (`Queue`) and workers (`Worker`).
  - Encapsulated by:
    - [`createJobQueue.declaration()`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:24)
    - [`createJobWorker.declaration()`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:61)
- MinIO/S3:
  - S3-compatible storage for manifests/audio.
  - Used through:
    - Orchestrator’s `S3ManifestStore`.
    - Optional [`createMinioClient.declaration()`](packages/batch-backend/src/infrastructure/minio.ts:20).
- SMTP/Mail (reserved for future use):
  - Env vars are defined for potential SMTP integration, but not used in current core batch-backend flows.
- Orchestrator:
  - Integrated via:
    - [`getPipeline.declaration()`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:23)
    - [`runAssignmentJob.declaration()`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:62)

### 2.3 Architectural Style

- Layered and modular:
  - `config` → `infrastructure` → `domain` → `application` → `transport`.
- Rationale:
  - Clear boundaries for testing and maintenance.
  - Easy to swap infra (DB/queue/storage) behind adapters.
  - Aligns with [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md).

---

## 3. Module and Component Structure

### 3.1 Layout

- [`packages/batch-backend/src/config`](packages/batch-backend/src/config)
  - Env-based configuration.
- [`packages/batch-backend/src/infrastructure`](packages/batch-backend/src/infrastructure)
  - Integrations: logger, metrics, db, redis, queue, minio, orchestrator.
- [`packages/batch-backend/src/domain`](packages/batch-backend/src/domain)
  - Job model and repository.
- [`packages/batch-backend/src/application`](packages/batch-backend/src/application)
  - Use cases: submitJob, getJobStatus, processQueueJob.
- [`packages/batch-backend/src/transport`](packages/batch-backend/src/transport)
  - HTTP server and worker entrypoints.

### 3.2 Key Components

Config:

- [`loadConfig.declaration()`](packages/batch-backend/src/config/env.ts:90)
  - Input: `process.env`.
  - Output: `BatchBackendConfig` with typed sections for http, pg, redis, queue, minio, mail, orchestrator.

Infrastructure:

- Logger:
  - [`logger.declaration()`](packages/batch-backend/src/infrastructure/logger.ts:18)
  - [`createJobLogger.declaration()`](packages/batch-backend/src/infrastructure/logger.ts:63)
- Metrics:
  - [`metrics.declaration()`](packages/batch-backend/src/infrastructure/metrics.ts:15)
- DB:
  - [`createPgPool.declaration()`](packages/batch-backend/src/infrastructure/db.ts:15)
  - [`withPgClient.declaration()`](packages/batch-backend/src/infrastructure/db.ts:40)
- Redis:
  - [`createRedisClient.declaration()`](packages/batch-backend/src/infrastructure/redis.ts:14)
- Queue (BullMQ):
  - [`createJobQueue.declaration()`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:24)
  - [`createJobWorker.declaration()`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:61)
- MinIO:
  - [`createMinioClient.declaration()`](packages/batch-backend/src/infrastructure/minio.ts:20)
- Orchestrator:
  - [`getPipeline.declaration()`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:23)
  - [`runAssignmentJob.declaration()`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:62)

Domain:

- [`JobState.declaration()`](packages/batch-backend/src/domain/job-model.ts:5)
- [`JobRecord.declaration()`](packages/batch-backend/src/domain/job-model.ts:9)
- [`insertJob.declaration()`](packages/batch-backend/src/domain/job-repository.ts:14)
- [`getJobById.declaration()`](packages/batch-backend/src/domain/job-repository.ts:39)
- [`updateJobStateAndResult.declaration()`](packages/batch-backend/src/domain/job-repository.ts:61)

Application:

- [`submitJob.declaration()`](packages/batch-backend/src/application/submit-job.ts:21)
- [`getJobStatus.declaration()`](packages/batch-backend/src/application/get-job-status.ts:18)
- [`processQueueJob.declaration()`](packages/batch-backend/src/application/process-queue-job.ts:18)

Transport:

- HTTP:
  - [`startHttpServer.declaration()`](packages/batch-backend/src/transport/http-server.ts:17)
- Worker:
  - [`startWorker.declaration()`](packages/batch-backend/src/transport/worker-runner.ts:15)

### 3.3 Public vs Internal APIs

Public (service boundary):

- HTTP endpoints:
  - POST /jobs
  - GET /jobs/:jobId
  - GET /jobs/:jobId/status (alias retained for legacy clients; new integrations MUST use `/jobs/:jobId`)
- Queue contract:
  - BullMQ jobs with payload `{ jobId: string }`.

Internal:

- All TS modules under `src/*`.
- External systems SHOULD NOT import internal functions directly; interact via HTTP/queue.

Experimental/extended HTTP routes (uploads/auth/admin/user management) exist in the codebase but are guarded by `BATCH_BACKEND_ENABLE_EXTENDED_API`. They are considered non-canonical until explicitly documented here.

---

## 4. Data and Domain Modeling

### 4.1 Core Entities

Job:

- Represents a single orchestrator run request.

[`JobRecord`](packages/batch-backend/src/domain/job-model.ts:9):

- `id: string` (UUID).
- `state: JobState` (`queued` | `running` | `succeeded` | `failed`).
- `md: string` (Markdown path).
- `preset?: string | null`.
- `withTts?: boolean | null`:
  - When omitted at submission, treated as `false` (no TTS) by current pipeline semantics.
- `upload?: string | null` (`'auto' | 's3' | 'none'` semantics mirror the frontend selector; only `'s3'` is forwarded to the orchestrator today).
- `voiceAccent?: string | null` — forwarded to the orchestrator as `accentPreference`.
- `forceTts?: boolean | null` — persisted for observability; orchestration wiring is pending.
- `notionDatabase?: string | null` — forwarded to the orchestrator as `dbId`.
- `mode?: string | null` — stored for the UI (future orchestrator support).
- `notionUrl?: string | null` — populated when the orchestrator returns a Notion `pageUrl`.
- Timestamps: `createdAt`, `updatedAt`, `startedAt`, `finishedAt`.
- `error?: string | null`.
- `manifestPath?: string | null`.

### 4.2 Schema and Repository

See comments in [`db.ts`](packages/batch-backend/src/infrastructure/db.ts:64). The `jobs` table matches `JobRecord`. Repository:

- Ensures mapping between DB rows and domain model.
- Parameterized queries only.

### 4.3 Invariants

- Job `id` is unique.
- Allowed transitions (see [`canTransition.declaration()`](packages/batch-backend/src/domain/job-model.ts:26)):
  - `queued` → `running`
  - `queued` → `failed` (for unrecoverable failures before processing can start)
  - `running` → `succeeded`
  - `running` → `failed`
- No transitions are allowed out of terminal states (`succeeded`, `failed`).
- Repository updates enforce `expectedState` to avoid races.
- `md` is required at submission.

### 4.5 Schema Migration – Phase 6 Columns

Existing deployments can add the new metadata columns without recreating the `jobs` table:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice_accent TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS force_tts BOOLEAN NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_database TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mode TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_url TEXT NULL;
```

All columns default to `NULL`, so historical rows remain valid.

### 4.4 Configuration Access

- All configuration and secrets accessed via [`loadConfig`](packages/batch-backend/src/config/env.ts:90).
- No direct `process.env` reads outside config layer (except orchestrator expectations).

---

## 5. Control Flow and Key Operations

### 5.1 Initialization

- Transport entrypoints call `loadConfig` and construct infra components on demand.
- Orchestrator pipeline is lazy-loaded on first use via [`getPipeline`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:23).

### 5.2 Job Submission (POST /jobs)

HTTP:

- Method: `POST`
- Path: `/jobs`
- Request body (JSON):
  - `md: string` (required)
  - `preset?: string`
  - `withTts?: boolean`
    - When omitted, treated as `false` (no TTS) in current canonical behavior.
  - `upload?: 'auto' | 's3' | 'none'`
    - `'s3'`: request orchestrator to upload via S3-compatible backend.
    - `'auto' | 'none'` (or omitted): do not override orchestrator defaults.
  - `voiceAccent?: string` — passed through as `accentPreference`.
  - `forceTts?: boolean` — persisted for Phase 8 UI controls (orchestrator wiring TBD).
  - `notionDatabase?: string` — forwarded as `dbId`.
  - `mode?: 'auto' | 'dialogue' | 'monologue'` — stored for UI state and SSE payloads.
- Responses:
  - `202 Accepted`:
    - Body: `{ "jobId": "<uuid>" }`
  - `400 Bad Request`:
    - Body: `{ "error": "validation_failed", "message": string, "code": string }`
      - For validation/submit failures (e.g. missing or invalid `md`).
  - `500 Internal Server Error`:
    - Body: `{ "error": "internal_error" }`

Flow:

1. HTTP route in [`http-server.ts`](packages/batch-backend/src/transport/http-server.ts:25).
2. Calls [`submitJob`](packages/batch-backend/src/application/submit-job.ts:21):
   - Validates `md`.
   - [`insertJob`](packages/batch-backend/src/domain/job-repository.ts:14) → `queued`.
   - [`createJobQueue().enqueue`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:49) with `{ jobId }`.
3. Returns 202 with `{ jobId }` on success.

### 5.3 Get Job Status (GET /jobs/:jobId)

HTTP:

- Method: `GET`
- Path: `/jobs/:jobId`
- Responses:
  - `200 OK`:
    - Body:
      - `jobId: string`
      - `state: 'queued' | 'running' | 'succeeded' | 'failed'`
      - `createdAt: string` (ISO 8601)
      - `updatedAt: string` (ISO 8601)
      - `startedAt?: string | null`
      - `finishedAt?: string | null`
      - `error?: string | null`
      - `manifestPath?: string | null`
  - `404 Not Found`:
    - Body: `{ "error": "not_found" }`
  - `500 Internal Server Error`:
    - Body: `{ "error": "internal_error" }`

Flow:

1. HTTP route in [`http-server.ts`](packages/batch-backend/src/transport/http-server.ts:42).
2. Calls [`getJobStatus`](packages/batch-backend/src/application/get-job-status.ts:18).
3. Returns serialized job as above or 404.

Notes:

- `/jobs/:jobId/status` is maintained as a backwards-compatible alias that hits the identical handler.
- No authentication is enforced by default; deploy behind trusted ingress as stated in §8. Additional endpoints that require authentication stay disabled unless `BATCH_BACKEND_ENABLE_EXTENDED_API=true`.

### 5.4 Worker Processing

Flow:

1. [`startWorker`](packages/batch-backend/src/transport/worker-runner.ts:15):
   - Creates worker with [`createJobWorker`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:61).
2. For each queue job:
   - Processor calls [`processQueueJob`](packages/batch-backend/src/application/process-queue-job.ts:18) with `{ jobId }`.
3. [`processQueueJob`](packages/batch-backend/src/application/process-queue-job.ts:18):
   - Loads job.
   - Skips if not found or already terminal.
   - Transitions `queued` → `running` with guarded update.
   - Calls [`runAssignmentJob`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:62) (orchestrator).
   - On success:
     - `running` → `succeeded`, persist `manifestPath`.
   - On failure:
     - `running` → `failed`, persist error, rethrow for BullMQ retry.

### 5.5 Shutdown

- Worker:
  - Handles SIGINT/SIGTERM, closes worker gracefully.
- HTTP:
  - Relies on container lifecycle; logs on startup failure and exits.

---

## 6. Error Handling, Reliability, Resilience

### 6.1 Strategy

- Log all errors with context (jobId, component).
- Use typed transitions to avoid partial states.
- Rely on:
  - DB for strong consistency of job metadata.
  - BullMQ for queue delivery and retries.

### 6.2 Retries

- Configured in [`createJobQueue`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:24):
  - attempts: 5
  - exponential backoff.
- `processQueueJob` rethrows on failure so BullMQ applies retry policy.

### 6.3 Idempotency and Consistency

- Idempotent on job state:
  - Retries after final `failed` do not re-run because state is terminal.
  - Double deliveries are mitigated by `expectedState` guards in updates.
- At-least-once execution semantics for queue messages.

---

## 7. Performance and Scalability

- Horizontally scalable:
  - Run multiple HTTP instances.
  - Run multiple worker instances.
- BullMQ + Redis:
  - Handles high throughput job enqueuing.
- Postgres:
  - Use appropriate indexes (e.g., on `id` and `(state, created_at)`).

No in-memory caching is implemented; model is deliberately simple.

---

## 8. Security, Compliance, Privacy

- Secrets only via env vars.
- No credentials or PII logged.
- Access control is assumed at gateway/network level; this package trusts authenticated callers.
- Should be deployed inside a trusted network.

---

## 9. Configuration, Extensibility, Customization

### 9.1 Environment-Based Config

Configuration is centralized in [`loadConfig`](packages/batch-backend/src/config/env.ts:81).
For a runnable reference, see [`.env.batch-backend.example`](.env.batch-backend.example) and
[`docker-compose.batch-backend.yml`](docker-compose.batch-backend.yml).

Keys (summarized):

- HTTP:
  - `BATCH_BACKEND_HTTP_PORT` (default: `8080`).
- Postgres:
  - `PG_ENABLED` (default: `true`).
  - `PG_HOST` (default: `postgres`), `PG_PORT` (default: `5432`),
    `PG_USER` (default: `esl`), `PG_PASSWORD` (default: `esl`),
    `PG_DATABASE` (default: `esl_batch`),
    `PG_CONNECTION_STRING` (optional; overrides host/user/password/db).
- Redis:
  - `REDIS_ENABLED` (default: `true`).
  - `REDIS_HOST` (default: `redis`), `REDIS_PORT` (default: `6379`),
    `REDIS_PASSWORD` (optional).
- Queue:
  - `BATCH_JOBS_QUEUE_NAME` (default: `esl-jobs`).
- MinIO / S3-compatible (optional):
  - `MINIO_ENABLED` (default: `true` in `development`/`test`, else `false`).
  - `MINIO_ENDPOINT` (default: `minio`), `MINIO_PORT` (default: `9000`),
    `MINIO_USE_SSL` (default: `false`),
    `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` (default: `minioadmin`),
    `MINIO_BUCKET` (default: `esl-pipeline`).
- Mail (reserved for future use):
  - `MAIL_ENABLED` (default: `false`),
  - `MAIL_HOST` (default: `mailhog`), `MAIL_PORT` (default: `1025`),
  - `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM` (default: `no-reply@example.local`),
  - `MAIL_SECURE` (default: `false`).
  - These are defined for potential future SMTP integration and are not used in current core flows.
- Orchestrator / pipeline:
  - `NOTION_TOKEN`
  - `ELEVENLABS_API_KEY`
  - `ESL_PIPELINE_MANIFEST_STORE` (`filesystem` | `s3`).
    - If `s3`, requires `ESL_PIPELINE_MANIFEST_BUCKET` or `MINIO_BUCKET`.
    - When `s3`, `AWS_REGION` (if set) is forwarded to [`S3ManifestStore.declaration()`](packages/orchestrator/src/adapters/manifest/s3.ts).
  - `ESL_PIPELINE_MANIFEST_BUCKET`
  - `ESL_PIPELINE_MANIFEST_PREFIX` (optional)
  - `ESL_PIPELINE_MANIFEST_ROOT` (default: `process.cwd()` when unset)
  - `ESL_PIPELINE_CONFIG_PROVIDER` (`local` | `http`, default: `local`).
    - If `http`, requires `ESL_PIPELINE_CONFIG_ENDPOINT`.
  - `ESL_PIPELINE_CONFIG_ENDPOINT`
  - `ESL_PIPELINE_CONFIG_TOKEN` (optional)
- `PIPELINE_CWD` (optional):
  - When set, overrides `process.cwd()` for orchestrator `cwd` as used by [`getPipeline.declaration()`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:23).
- Extended/experimental HTTP API:
  - `BATCH_BACKEND_ENABLE_EXTENDED_API` (default: `false`)
    - When `true`, registers optional upload/auth/admin/user routes that are still under development. The stable service contract remains POST/GET jobs regardless of this flag.

Mapping to orchestrator:

- `loadConfig` maps these env vars into `config.orchestrator.*`.
- [`getPipeline`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:23) uses:
  - `config.orchestrator.manifestStore` to select `S3ManifestStore` (S3/MinIO) vs filesystem.
  - `config.orchestrator.configProvider` to select `RemoteConfigProvider` vs local.
- Batch-backend does not invent new pipeline semantics; it forwards these to orchestrator according to the SSOT.

### 9.2 Extension Points

- Infra adapters (`db.ts`, `redis.ts`, `queue-bullmq.ts`, `minio.ts`, `orchestrator-service.ts`) are the primary extension points.
- New features MUST:
  - Respect layer boundaries.
  - Avoid leaking infra details into application/domain.

---

## 10. Testing and Quality Strategy

Recommended tests:

- Unit:
  - Domain: state transitions, repository mapping.
  - Application: submitJob, getJobStatus, processQueueJob with mocks.
- Integration:
  - With Postgres/Redis via docker-compose or testcontainers:
    - POST /jobs → worker → GET /jobs.
- Contract:
  - Validate HTTP responses and job lifecycle semantics.

CI SHOULD run:

- `pnpm install`
- `pnpm -r build`
- Package-specific tests once added.

---

## 11. Observability and Operations

Logging:

- Structured logs via [`logger`](packages/batch-backend/src/infrastructure/logger.ts:18).
- `createJobLogger(jobId, runId?)` attaches `jobId`/`runId` to log entries.
- Worker and HTTP paths log:
  - Job submission/enqueue.
  - Worker start/success/failure.
  - Infra errors (Postgres/Redis/MinIO/BullMQ).
- Orchestrator integration:
  - [`getPipeline`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:23) injects a logger adapter so
    orchestrator stage events are emitted through the same structured logger.

Metrics:

- Exposed via [`metrics`](packages/batch-backend/src/infrastructure/metrics.ts:15) for future integration (noop by default).
- Aligns with orchestrator’s `PipelineMetrics` interfaces; safe to plug in Prometheus/statsd.

Operational notes:

- `runId` usage:
  - Worker sets `runId = jobId` when invoking [`runAssignmentJob`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:94),
    enabling correlation across logs/metrics and orchestrator events.
- Worker concurrency:
  - Currently fixed to `5` in [`createJobWorker.declaration()`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:61) and treated as an internal tuning parameter.

Common issues:

- Redis down → queue failures.
- Postgres down → submit/status failures.
- Orchestrator misconfig → job failures; inspect `job.error` and orchestrator logs.

---

## 12. Versioning, Compatibility, Migration

- `@esl-pipeline/batch-backend` is an internal workspace service (private package).
- Shares the same runtime/tooling baseline as orchestrator:
  - Node 24.10.0+ (see repo `.nvmrc` / root `package.json`).
  - pnpm 8+.
  - `ffmpeg` available when orchestrator TTS is enabled.
- HTTP/queue contracts documented above MUST be treated as stable:
  - Breaking changes require coordinated rollout and updates here and in consumers.

Migration:

- From ad-hoc scripts:
  - Use /jobs and workers instead of custom orchestrator usage.
  - Gradually route workloads to this service.

---

## 13. Rationale and Trade-offs

Key decisions:

- Layered architecture:
  - Chosen for clarity.
- BullMQ/Redis:
  - Simple, robust; avoids reinventing queuing.
- Postgres:
  - Familiar; supports rich querying and auditing.
- Minimal abstractions:
  - Adapters are thin; no complex plugin framework.

Trade-offs:

- Some configuration duplication with orchestrator, but:
  - Centralized via env loader.
  - Maintains clear ownership.
- Queue-level retries used instead of custom retry engine:
  - Simpler and sufficient.

---

## 14. Maintenance Rules

- Any change to:
  - Job lifecycle.
  - Public HTTP or queue contracts.
  - Infra adapter behavior.
  - Orchestrator integration.
- MUST:
  - Update this document.
  - Update relevant code and tests in the same change set.

This SSOT governs future development, maintenance, onboarding, and audits for `@esl-pipeline/batch-backend`.
