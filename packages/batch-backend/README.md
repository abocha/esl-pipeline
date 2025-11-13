# @esl-pipeline/batch-backend

Internal batch execution backend for the ESL Pipeline monorepo.

`@esl-pipeline/batch-backend` exposes a small, stable HTTP and queue surface for running ESL pipeline assignments asynchronously. It wraps the canonical pipeline engine from [`@esl-pipeline/orchestrator`](packages/orchestrator/README.md) behind a durable job model backed by Postgres, Redis/BullMQ, and optional S3/MinIO-based manifest storage. Callers submit Markdown-based jobs and track their lifecycle via this service, while all domain behavior (validation, extraction, Notion, TTS, uploads) remains owned by the orchestrator.

Within the monorepo, `batch-backend` is the standardized “batch execution surface”: external systems talk only to this service (HTTP/queue). The service is responsible for persistence, queuing, retries, and observability; actual lesson-processing semantics are delegated to the orchestrator and its adapters as defined in the SSOT.

---

## Features

- HTTP API for asynchronous jobs
  - Submit new jobs and fetch job status via a minimal, typed interface.
- Durable job lifecycle
  - Jobs persisted in Postgres with explicit states:
    - `queued` → `running` → `succeeded` or `failed`.
  - Strict, validated state transitions; no double-processing.
- Asynchronous execution via BullMQ
  - Redis-backed queue with controlled attempts, backoff, and cleanup.
  - Decouples ingestion from processing and supports horizontal scaling.
- Orchestrator-native execution
  - Lazily constructs and caches an `@esl-pipeline/orchestrator` pipeline.
  - For each job, invokes `pipeline.newAssignment()` with controlled flags.
- Pluggable infra and storage
  - Configurable Postgres, Redis, and S3-compatible (MinIO) storage.
  - Manifest storage and config-provider behavior wired through env and orchestrator.
- Structured observability
  - Pino-based, structured logs for HTTP, queue, worker, and orchestrator events.
  - Metrics interface aligned with the orchestrator (no-op by default, ready for integration).
- Strict, centralized configuration
  - All environment variables parsed and validated in one place.
  - Fails fast only when enabled features are misconfigured.

---

## Architecture and Role in the System

High-level view:

- `batch-backend` runs as two cooperating processes:
  - An HTTP API for job submission and status queries.
  - A BullMQ-based worker to execute jobs.
- Postgres acts as the durable job store:
  - Tracks job metadata, lifecycle state, manifest paths, and errors.
- Redis/BullMQ provides the work queue:
  - Decouples API from processing and supports horizontal worker scaling.
- Optional MinIO/S3 is used for pipeline manifests when configured.
- `@esl-pipeline/orchestrator` (and downstream packages like `md-validator`, `md-extractor`, `notion-importer`, `tts-elevenlabs`, `storage-uploader`, `notion-add-audio`) implements the actual ESL content pipeline.
- `batch-backend` does not redefine pipeline behavior:
  - It orchestrates, persists, and observes orchestrator runs.

Key modules (indicative):

- Config: [`loadConfig.declaration()`](packages/batch-backend/src/config/env.ts:81)
- Job model and transitions: [`JobState` and helpers](packages/batch-backend/src/domain/job-model.ts:26)
- Repository: [`job-repository.declaration()`](packages/batch-backend/src/domain/job-repository.ts:14)
- Queue adapter: [`queue-bullmq.declaration()`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:24)
- Orchestrator bridge: [`orchestrator-service.declaration()`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:23)
- HTTP server: [`createHttpServer.declaration()`](packages/batch-backend/src/transport/http-server.ts:53)
- Worker runner: [`startWorker.declaration()`](packages/batch-backend/src/transport/worker-runner.ts:17)

For authoritative contracts, see [`docs/batch-backend-ssot.md`](docs/batch-backend-ssot.md).

---

## Installation and Prerequisites

This package is designed to run inside the ESL Pipeline monorepo or as a built container image. It is marked `private` in [`package.json`](packages/batch-backend/package.json) and is not intended for standalone npm consumption.

Prerequisites:

- Node.js 24.10.0+ (aligned with repo toolchain)
- pnpm 8+ (`corepack enable`)
- Postgres (for job persistence)
- Redis (for BullMQ queue)
- Optional:
  - MinIO or S3-compatible storage (for manifest storage)
  - SMTP endpoint (for potential email integration)
  - Notion, ElevenLabs, AWS credentials as required by `@esl-pipeline/orchestrator`
- Recommended:
  - Containerized deployment via `docker-compose.batch-backend.yml` and associated images.

Install and build inside the monorepo:

- Install dependencies at repo root:

  ```bash
  pnpm install
  ```

- Build the package:

  ```bash
  pnpm --filter @esl-pipeline/batch-backend build
  ```

---

## Running the Service

`batch-backend` runs as two cooperating processes that share the same configuration:

- HTTP API:
  - Script:
    ```bash
    pnpm --filter @esl-pipeline/batch-backend start:api
    ```
  - Entrypoint: [`startHttpServer.declaration()`](packages/batch-backend/src/transport/http-server.ts:145)

- Worker:
  - Script:
    ```bash
    pnpm --filter @esl-pipeline/batch-backend start:worker
    ```
  - Entrypoint: [`startWorker.declaration()`](packages/batch-backend/src/transport/worker-runner.ts:17)

Both require consistent `PG_*`, `REDIS_*`, and orchestrator-related env configuration.

For local development, use the root `docker-compose.batch-backend.yml` (or equivalent) to start:

- Postgres
- Redis
- MinIO (optional)
- `batch-backend` API
- `batch-backend` worker

---

## Configuration

All configuration is centralized in [`loadConfig.declaration()`](packages/batch-backend/src/config/env.ts:81). The following environment variables are recognized.

HTTP:

- `BATCH_BACKEND_HTTP_PORT`
  - Port for HTTP server.
  - Default: `8080`.

Postgres (job store):

- `PG_ENABLED`
  - Enable Postgres-backed job persistence.
  - Default: `true`.
- `PG_CONNECTION_STRING`
  - Optional; if set and `PG_ENABLED=true`, used instead of individual params.
- `PG_HOST` (default: `postgres`)
- `PG_PORT` (default: `5432`)
- `PG_USER` (default: `esl`)
- `PG_PASSWORD` (default: `esl`)
- `PG_DATABASE` (default: `esl_batch`)

If Postgres is enabled but required values are missing, startup fails fast.

Redis (queue):

- `REDIS_ENABLED`
  - Enable Redis/BullMQ.
  - Default: `true`.
- `REDIS_HOST` (default: `redis`)
- `REDIS_PORT` (default: `6379`)
- `REDIS_PASSWORD`
  - Optional.

Queue:

- `BATCH_JOBS_QUEUE_NAME`
  - BullMQ queue name used by both API and worker.
  - Default: `esl-jobs`.

MinIO / S3-compatible manifest storage:

- `MINIO_ENABLED`
  - Enable MinIO/S3-compatible integration.
  - Default: see SSOT; typically enabled in dev via example configs.
- `MINIO_ENDPOINT` (default: `minio`)
- `MINIO_PORT` (default: `9000`)
- `MINIO_USE_SSL` (default: `false`)
- `MINIO_ACCESS_KEY` (default: `minioadmin`)
- `MINIO_SECRET_KEY` (default: `minioadmin`)
- `MINIO_BUCKET` (default: `esl-pipeline`)

Mail (present but not part of the core job flow in this version):

- `MAIL_ENABLED` (default: `false`)
- `MAIL_HOST` (default: `mailhog`)
- `MAIL_PORT` (default: `1025`)
- `MAIL_USER` (optional)
- `MAIL_PASSWORD` (optional)
- `MAIL_FROM` (default: `no-reply@example.local`)
- `MAIL_SECURE` (default: `false`)

Orchestrator / pipeline integration:

- `NOTION_TOKEN`
- `ELEVENLABS_API_KEY`
- `ESL_PIPELINE_MANIFEST_STORE`
  - `filesystem` | `s3`.
  - Default:
    - `s3` when `MINIO_ENABLED=true`, otherwise `filesystem`.
- `ESL_PIPELINE_MANIFEST_BUCKET`
  - Required when `manifestStore='s3'`.
- `ESL_PIPELINE_MANIFEST_PREFIX` (optional)
- `ESL_PIPELINE_MANIFEST_ROOT`
  - Default: `process.cwd()`.
- `ESL_PIPELINE_CONFIG_PROVIDER`
  - `local` | `http`, default: `local`.
- `ESL_PIPELINE_CONFIG_ENDPOINT`
  - Required when provider is `http`.
- `ESL_PIPELINE_CONFIG_TOKEN`
  - Optional; forwarded to remote config provider.
- `PIPELINE_CWD`
  - Optional; overrides `cwd` used when constructing the orchestrator pipeline.

Any enabled subsystem with missing or inconsistent configuration will cause deterministic startup errors.

---

## Public HTTP API

HTTP behavior is implemented in [`createHttpServer.declaration()`](packages/batch-backend/src/transport/http-server.ts:53) and exposed via [`startHttpServer.declaration()`](packages/batch-backend/src/transport/http-server.ts:145).

Security/auth:

- No authentication or authorization is implemented in this package.
- It is intended to run behind trusted ingress (API gateway, service mesh, etc.).
- Apply authentication and authorization at the edge.

Error envelope (via [`errorResponse.declaration()`](packages/batch-backend/src/transport/http-server.ts:14)):

- Validation error (`400`):
  - `{"error":"validation_failed","message":string,"code":string}`
- Not found (`404`):
  - `{"error":"not_found"}`
- Internal error (`500`):
  - `{"error":"internal_error"}`

### POST /jobs

[`POST /jobs`](packages/batch-backend/src/transport/http-server.ts:58)

Submit a new asynchronous ESL pipeline job.

Request:

- Method: `POST`
- Path: `/jobs`
- Headers:
  - `Content-Type: application/json`
- Body (`SubmitJobRequest`):
  - `md: string` (required)
    - Markdown lesson path/identifier; non-empty.
  - `preset?: string` (optional)
    - Forwarded as-is to orchestrator.
  - `withTts?: boolean` (optional)
    - Forwarded to orchestrator; absence uses orchestrator defaults.
  - `upload?: string` (optional)
    - Persisted as-is on the job record.
    - If value is `'s3'`, the worker forwards it as an explicit upload target.
    - Other values result in no explicit upload override.

Responses:

- `202 Accepted`
  - `{"jobId": string}` (UUID used to track the job).
- `400 Bad Request`
  - On validation failure (e.g., missing/invalid `md`).
- `500 Internal Server Error`
  - On unexpected failures (DB, queue, config, etc.).

Side effects:

- Inserts a new job row in Postgres with:
  - `state="queued"`.
- Enqueues a BullMQ job `{ "jobId": string }` on the configured queue.
- Logs structured submission events.

### GET /jobs/:jobId

[`GET /jobs/:jobId`](packages/batch-backend/src/transport/http-server.ts:103)

Retrieve the current status and metadata for a previously submitted job.

Request:

- Method: `GET`
- Path: `/jobs/:jobId`
- Params:
  - `jobId: string` — UUID returned by `POST /jobs`.

Successful response (`200 OK`):

- JSON body derived from the persisted job record:

  ```json
  {
    "jobId": "string",
    "state": "queued | running | succeeded | failed",
    "createdAt": "ISO-8601 string",
    "updatedAt": "ISO-8601 string",
    "startedAt": "ISO-8601 string or null",
    "finishedAt": "ISO-8601 string or null",
    "error": "string or null",
    "manifestPath": "string or null"
  }
  ```

Error responses:

- `404 Not Found`
  - When the job does not exist.
- `500 Internal Server Error`
  - On unexpected failures.

Side effects:

- Read-only.
- Emits structured logs with request and resolution details.

---

## Worker and Job Processing Flow

Worker behavior combines:

- [`startWorker.declaration()`](packages/batch-backend/src/transport/worker-runner.ts:17)
- [`createJobWorker.declaration()`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:77)
- [`processQueueJob.declaration()`](packages/batch-backend/src/application/process-queue-job.ts:18)
- [`runAssignmentJob.declaration()`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:62)

End-to-end flow:

1. Queueing
   - `POST /jobs` enqueues `{ jobId }` via [`createJobQueue`](packages/batch-backend/src/infrastructure/queue-bullmq.ts:24).
   - Queue configuration:
     - Name: from `BATCH_JOBS_QUEUE_NAME`.
     - Attempts: `5`.
     - Backoff: exponential, 1000 ms.
     - `removeOnComplete`: `1000`
     - `removeOnFail`: `1000`
   - `QueueEvents` log:
     - `queue_waiting`, `queue_completed`, `queue_failed`.

2. Worker startup
   - `startWorker`:
     - Creates a BullMQ worker bound to the same queue.
     - Concurrency: `5`.
     - Registers event handlers:
       - `active`, `completed`, `failed`, `error` with contextual logs.
     - Handles `SIGINT` / `SIGTERM`:
       - Attempts graceful `worker.close()`, logs, and exits.

3. Processing (`processQueueJob`)
   - Loads the job via [`getJobById`](packages/batch-backend/src/domain/job-repository.ts:39).
   - If job is missing or already `succeeded` / `failed`:
     - No-op (avoids double-processing).
   - Attempts transition `queued` → `running`:
     - Uses `expectedState='queued'` to enforce optimistic concurrency.
     - If transition fails (null), another worker has claimed it → abort.
   - On successful transition to `running`:
     - Calls [`runAssignmentJob`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:62) with:
       - `jobId`
       - `md`
       - `preset?`
       - `withTts?`
       - `upload: 's3'` only if requested.
       - `runId = jobId` for correlation.

4. Orchestrator execution (`runAssignmentJob`)
   - [`getPipeline`](packages/batch-backend/src/infrastructure/orchestrator-service.ts:23):
     - Lazily constructs a pipeline using `createPipeline` from orchestrator with:
       - `cwd`: `PIPELINE_CWD` or `process.cwd()`.
       - Logger: wired to batch-backend logger.
       - Metrics: from [`metrics`](packages/batch-backend/src/infrastructure/metrics.ts:15).
       - Manifest/config adapters derived from environment configuration.
   - Invokes `pipeline.newAssignment(flags, { runId })`.
   - On success:
     - Updates job `running` → `succeeded`.
     - Sets `manifestPath` and timestamps.
   - On failure:
     - Logs error.
     - Updates job `running` → `failed` with error message and timestamps.
     - Rethrows so BullMQ applies its retry strategy.

The worker never reimplements Markdown, Notion, TTS, or upload logic; it only coordinates orchestrator execution, job state, and retries.

---

## Public API (Service Contracts)

While this package is deployed as a service rather than a typical library, several contracts are important for integrators.

Queue payload:

- BullMQ jobs have payload:
  - `{ jobId: string }`
- Queue name:
  - `BATCH_JOBS_QUEUE_NAME` (default `esl-jobs`)

Job record shape (Postgres and `GET /jobs/:jobId`):

- `id: string` (UUID; exposed as `jobId`)
- `md: string`
- `preset?: string | null`
- `withTts?: boolean | null`
- `upload?: string | null`
- `state: 'queued' | 'running' | 'succeeded' | 'failed'`
- `createdAt`, `updatedAt`, `startedAt?`, `finishedAt?`
- `manifestPath?: string | null`
- `error?: string | null`

Key internal functions (stability expectations for service behavior):

- [`submitJob.declaration()`](packages/batch-backend/src/application/submit-job.ts:62)
  - Validates and persists job.
  - Enqueues queue message.
- [`getJobStatus.declaration()`](packages/batch-backend/src/application/get-job-status.ts:18)
  - Reads and returns job status DTO.
- [`processQueueJob.declaration()`](packages/batch-backend/src/application/process-queue-job.ts:18)
  - Orchestrates job lifecycle and pipeline calls.
- [`createHttpServer.declaration()`](packages/batch-backend/src/transport/http-server.ts:53)
- [`startHttpServer.declaration()`](packages/batch-backend/src/transport/http-server.ts:145)
- [`startWorker.declaration()`](packages/batch-backend/src/transport/worker-runner.ts:17)

Integrations should treat the HTTP and queue contracts above as the supported public surface.

---

## Usage Examples

### Initialize and run locally

Using Docker Compose (conceptual):

```bash
docker-compose -f docker-compose.batch-backend.yml up -d
```

This should start:

- Postgres (with appropriate schema)
- Redis
- MinIO (optional)
- `batch-backend` HTTP API on `http://localhost:8080`
- `batch-backend` worker

Ensure environment variables match `.env.batch-backend.example` and SSOT.

### Submit a job

```bash
curl -X POST http://localhost:8080/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "md": "./lessons/mission.md",
    "preset": "b1-default",
    "withTts": true,
    "upload": "s3"
  }'
```

Success:

```json
{
  "jobId": "4f8a4e9c-5d76-4f21-8a45-1a2b3c4d5e6f"
}
```

### Check job status

```bash
curl http://localhost:8080/jobs/4f8a4e9c-5d76-4f21-8a45-1a2b3c4d5e6f
```

Example (running):

```json
{
  "jobId": "4f8a4e9c-5d76-4f21-8a45-1a2b3c4d5e6f",
  "state": "running",
  "createdAt": "2025-01-01T10:00:00.000Z",
  "updatedAt": "2025-01-01T10:00:05.000Z",
  "startedAt": "2025-01-01T10:00:01.000Z",
  "finishedAt": null,
  "error": null,
  "manifestPath": null
}
```

Example (succeeded):

```json
{
  "jobId": "4f8a4e9c-5d76-4f21-8a45-1a2b3c4d5e6f",
  "state": "succeeded",
  "createdAt": "2025-01-01T10:00:00.000Z",
  "updatedAt": "2025-01-01T10:00:10.000Z",
  "startedAt": "2025-01-01T10:00:01.000Z",
  "finishedAt": "2025-01-01T10:00:09.000Z",
  "error": null,
  "manifestPath": "s3://esl-pipeline/manifests/mission.json"
}
```

Example (failed):

```json
{
  "jobId": "4f8a4e9c-5d76-4f21-8a45-1a2b3c4d5e6f",
  "state": "failed",
  "createdAt": "2025-01-01T10:00:00.000Z",
  "updatedAt": "2025-01-01T10:00:10.000Z",
  "startedAt": "2025-01-01T10:00:01.000Z",
  "finishedAt": "2025-01-01T10:00:09.000Z",
  "error": "Assignment pipeline failed: <reason>",
  "manifestPath": null
}
```

### Typical backend integration

Your backend service can delegate ESL processing to `batch-backend`:

```ts
async function submitLesson(mdPath: string): Promise<string> {
  const res = await fetch('http://batch-backend.internal/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      md: mdPath,
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to submit job: ${res.status}`);
  }

  const { jobId } = await res.json();
  return jobId as string;
}

async function getLessonJobStatus(jobId: string) {
  const res = await fetch(`http://batch-backend.internal/jobs/${jobId}`);

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Status check failed: ${res.status}`);
  }

  return (await res.json()) as {
    jobId: string;
    state: 'queued' | 'running' | 'succeeded' | 'failed';
    manifestPath?: string | null;
    error?: string | null;
  };
}
```

Your code never calls `@esl-pipeline/orchestrator` directly; `batch-backend` is the integration boundary.

---

## Observability

Logging:

- Implemented via Pino:
  - [`logger.declaration()`](packages/batch-backend/src/infrastructure/logger.ts:18)
  - [`createJobLogger.declaration()`](packages/batch-backend/src/infrastructure/logger.ts:63)
- Characteristics:
  - Structured JSON logs suitable for aggregation.
  - Per-job child loggers with `jobId`/`runId` context.
- Key events:
  - HTTP:
    - Requests, responses, and route handlers.
  - Queue:
    - `queue_waiting`, `queue_completed`, `queue_failed`.
  - Worker:
    - `worker_active`, `worker_completed`, `worker_failed`, lifecycle events.
  - Orchestrator:
    - Assignment success/failure, durations, manifest paths.
  - Infra:
    - DB/Redis/BullMQ errors.

Metrics:

- Interface defined in [`metrics.declaration()`](packages/batch-backend/src/infrastructure/metrics.ts:15).
- Default implementation is a no-op.
- Mirrors the orchestrator’s metrics surface so it can be wired to Prometheus/StatsD/etc. without changing calling code.

Recommended:

- Route logs into centralized logging (e.g., ELK, Loki, Cloud Logging).
- Provide a concrete metrics implementation in production for job throughput, latency, and failure ratios.

---

## Error Handling and Failure Modes

Patterns:

- HTTP:
  - Centralized error mapping via `errorResponse`.
  - Validation issues → `400` with `validation_failed`.
  - Missing jobs → `404` with `not_found`.
  - Unexpected exceptions → `500` with `internal_error`.
- Job state integrity:
  - Transitions enforced by [`canTransition`](packages/batch-backend/src/domain/job-model.ts:26) and [`assertTransition`](packages/batch-backend/src/domain/job-model.ts:44).
  - Repository methods require `expectedState` to match current DB value.
  - Terminal states `succeeded` and `failed` are final.
- Queue/worker:
  - `processQueueJob`:
    - No-op for missing or terminal jobs.
    - On orchestrator error:
      - Job set to `failed` with error message.
      - Error rethrown so BullMQ applies retries (5 attempts, exponential backoff).
- Configuration:
  - `loadConfig` fails fast for invalid/missing required settings when a feature is enabled.
- Common failure modes:
  - Postgres down:
    - `POST /jobs` / `GET /jobs/:jobId` return `500`.
  - Redis down:
    - Job enqueue fails → `500` on submit; worker logs errors.
  - MinIO/S3 or remote config misconfig:
    - Orchestrator failures → job `failed`; cause visible in `error`.
  - Orchestrator misconfig:
    - Jobs fail; diagnose via `error` and orchestrator logs.

Failures surface clearly through job status; there are no hidden side effects.

---

## Performance and Production Considerations

- Horizontal scaling:
  - Run multiple worker instances safely; optimistic concurrency prevents double-processing.
  - Scale API and worker processes independently.
- Queue tuning:
  - BullMQ attempts/backoff/concurrency are set in code; adjust there if needed.
- Dependencies:
  - Provision Postgres and Redis for expected throughput; both are critical.
- Network and latency:
  - Co-locate workers with orchestrator dependencies (S3, Notion, ElevenLabs) when possible.
- Idempotency:
  - Job model and queue semantics minimize duplicate runs; avoid manually mutating job records.

---

## Testing and Development

Package scripts (see [`package.json`](packages/batch-backend/package.json)):

- Build:

  ```bash
  pnpm --filter @esl-pipeline/batch-backend build
  ```

- Test:

  ```bash
  pnpm --filter @esl-pipeline/batch-backend test
  ```

- Verbose tests:

  ```bash
  pnpm --filter @esl-pipeline/batch-backend test:verbose
  ```

- Watch mode:

  ```bash
  pnpm --filter @esl-pipeline/batch-backend test:watch
  ```

Tests live under [`packages/batch-backend/tests`](packages/batch-backend/tests) and cover:

- Env/config parsing
- Job model transitions
- Repository behavior
- Orchestrator service integration
- HTTP server integration
- Worker-runner integration

For local development:

- Use `docker-compose.batch-backend.yml` to run dependencies and the service.
- Edit sources in [`packages/batch-backend/src`](packages/batch-backend/src) and rebuild or use Node with TS output.
- Follow repo-wide guidelines:
  - [`AGENTS.md`](AGENTS.md)
  - [`docs/agents-ssot.md`](docs/agents-ssot.md)
  - [`CONTRIBUTING.md`](CONTRIBUTING.md)

---

## Versioning, Maintenance, and Contributions

- `@esl-pipeline/batch-backend` is part of the ESL Pipeline monorepo and follows its release and versioning strategy.
- The package is `private`; it is shipped as a service, not as a standalone library.
- Any change to:
  - HTTP contracts,
  - Queue payload/behavior,
  - Job state model,
  - Orchestrator integration
    must:
  - Align with [`docs/batch-backend-ssot.md`](docs/batch-backend-ssot.md).
  - Maintain compatibility with `@esl-pipeline/orchestrator` or be treated as a breaking change.
- Contributions:
  - Follow [`CONTRIBUTING.md`](CONTRIBUTING.md).
  - Update tests and documentation in lockstep with behavior changes.
  - Treat divergence from SSOT as a bug.

---

## FAQ / Troubleshooting

Q: Jobs stay in `queued` and never run  
A:

- Ensure the worker (`start:worker`) is running.
- Confirm `REDIS_ENABLED=true` and `REDIS_HOST`/`REDIS_PORT` are correct.
- Check `BATCH_JOBS_QUEUE_NAME` matches between API and worker.
- Inspect worker logs for BullMQ errors.

Q: `POST /jobs` returns `500`  
A:

- Verify Postgres connectivity and `PG_*` or `PG_CONNECTION_STRING` values.
- Verify Redis is reachable (used for enqueueing).
- Check logs for configuration or connection errors.

Q: `GET /jobs/:jobId` returns `404`  
A:

- Confirm you are using the exact `jobId` from `POST /jobs`.
- Ensure Postgres was available at submission time so the job could be persisted.

Q: Jobs consistently end in `failed`  
A:

- Inspect the `error` field from `GET /jobs/:jobId`.
- Validate orchestrator-related configuration:
  - Notion, ElevenLabs, S3/MinIO, manifest store, and config-provider vars.
- Check orchestrator logs for root cause.

Q: How do I secure the API?  
A:

- `batch-backend` does not include auth.
- Run it behind an API gateway or service mesh and enforce authentication/authorization there.

Q: Can I push jobs directly onto the BullMQ queue?  
A:

- The supported queue contract is payloads of shape `{ jobId: string }` for the configured queue.
- Jobs are expected to exist in Postgres; creating queue-only jobs is unsupported and may lead to no-ops.

---

## Summary

Use `@esl-pipeline/batch-backend` when you need a robust, observable, horizontally scalable way to run ESL pipeline assignments asynchronously. It standardizes submission and tracking over HTTP plus a BullMQ worker model, while delegating all core pipeline semantics to `@esl-pipeline/orchestrator` and its adapters, ensuring a single, consistent source of truth for ESL content processing across your system.
