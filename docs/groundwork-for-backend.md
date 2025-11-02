# Backend Integration Guide (2025-11-02)

The orchestrator package is now designed to embed directly into backend services. This guide captures the current state and lays out a step-by-step integration plan so you can wire the pipeline into workers, queues, and deployment pipelines without guesswork.

---

## 1. Current Capabilities

| Area | Status | Notes |
|------|--------|-------|
| Adapters | ✅ | Filesystem + S3 `ManifestStore`, filesystem + HTTP `ConfigProvider`, selectable via env or constructor. |
| Observability | ✅ | Injected `logger` / `metrics` hooks, structured stage events, run IDs. |
| Containerization | ✅ | `packages/orchestrator/Dockerfile` builds an image ready to run the CLI or service. |
| Service Skeleton | ✅ | `examples/service/` Fastify worker, dry-run POST `/jobs`, Vitest smoke test. |
| CI | ✅ | GitHub workflow runs on Node 24 + LTS, builds docker image, executes example service test. |
| Release | ✅ | Changesets-based flow, documented publish steps. |

Open items (future work): database-backed manifest store, queue helper utilities, advanced tenant/secret providers.

---

## 2. Integration Checklist

### Step 0 – Prerequisites
1. Node.js 24.10.0+, pnpm (8 or 10), Docker, ffmpeg on your machine/runner.
2. Credentials: Notion, ElevenLabs, AWS (if using S3).
3. Access to your target repository/monorepo where the backend worker will live.

### Step 1 – Install the Package
```bash
pnpm add @esl-pipeline/orchestrator
```

For local defaults, copy prebuilt configs:
```bash
mkdir -p configs
cp -R node_modules/@esl-pipeline/orchestrator/dist/configs ./configs
```

Load environment variables (via `.env`, secret manager, etc.). Required minimum:
- `NOTION_TOKEN`
- `ELEVENLABS_API_KEY`
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (if uploading to S3)

Optional (remote adapters):
- `ESL_PIPELINE_MANIFEST_STORE=s3`
- `ESL_PIPELINE_MANIFEST_BUCKET`
- `ESL_PIPELINE_CONFIG_PROVIDER=http`
- `ESL_PIPELINE_CONFIG_ENDPOINT`

### Step 2 – Choose Storage/Config Mode

**Filesystem only:** do nothing; manifests live next to Markdown, configs read from `configs/`.

**S3 manifests + remote config:**
```ts
import {
  createPipeline,
  S3ManifestStore,
  RemoteConfigProvider,
} from '@esl-pipeline/orchestrator';

const pipeline = createPipeline({
  cwd: process.env.PIPELINE_CWD ?? process.cwd(),
  manifestStore: new S3ManifestStore({
    bucket: process.env.ESL_PIPELINE_MANIFEST_BUCKET!,
    prefix: process.env.ESL_PIPELINE_MANIFEST_PREFIX,
    region: process.env.AWS_REGION,
    rootDir: process.cwd(),
  }),
  configProvider: new RemoteConfigProvider({
    baseUrl: process.env.ESL_PIPELINE_CONFIG_ENDPOINT!,
    token: process.env.ESL_PIPELINE_CONFIG_TOKEN,
  }),
});
```

### Step 3 – Embed in a Service

Start with the example worker (`packages/orchestrator/examples/service`):
```ts
import Fastify from 'fastify';
import { createPipeline, noopLogger, noopMetrics } from '@esl-pipeline/orchestrator';

const pipeline = createPipeline({
  cwd: process.env.PIPELINE_CWD ?? process.cwd(),
  logger: noopLogger,      // replace with pino/winston
  metrics: noopMetrics,    // replace with statsd/Prometheus
});

const app = Fastify({ logger: true });

app.post('/jobs', async (req, reply) => {
  const body = req.body as { md?: string; jobId?: string };
  if (!body?.md) return reply.code(400).send({ error: 'md is required' });

  const result = await pipeline.newAssignment(
    {
      md: body.md,
      dryRun: true,
      skipImport: true,
      skipTts: true,
      skipUpload: true,
    },
    undefined,
    { runId: body.jobId }
  );

  return { jobId: body.jobId ?? body.md, result };
});

await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
```

From here you can remove `dryRun`/`skip*` flags once you’re ready to hit live services.

### Step 4 – Queue Integration

1. Pick a queue (BullMQ, SQS, Cloud Tasks, etc.).
2. Inside the queue consumer, call `pipeline.newAssignment(job.payload, undefined, { runId: job.id })`.
3. Persist job status using the returned `steps`, timestamps, and `manifestPath`.
4. On failure, catch errors and mark the queue job accordingly (retries/backoff handled by the queue).

Example payload contract:
```json
{
  "jobId": "5f9...",
  "md": "lessons/unit1.md",
  "withTts": true,
  "upload": "s3",
  "preset": "b1-default",
  "student": "Alice"
}
```

### Step 5 – Observability

1. Replace `noopLogger` with a real logger:
   ```ts
   import pino from 'pino';
   const log = pino();
   const logger = {
     log: event => log.info({ ...event }, event.message),
   };
   ```
2. Replace `noopMetrics` with your metrics sink (statsd, Prometheus client). The pipeline emits `timing` and `increment` calls for each stage.
3. Propagate `runId` (usually the queue job ID) to tie logs and metrics together.

### Step 6 – Storage Details

- **Manifests**: S3 store is recommended for multi-worker setups. Filesystem store works for local dev or single-instance deployments. S3 manifest keys mirror Markdown structure unless you provide a `rootDir`/`prefix`.
- **Audio files**: the pipeline writes MP3s to the output directory. For serverless or containerized workers, set `defaultOutDir` to an ephemeral volume and rely on the S3 upload step to persist audio.

### Step 7 – Error Handling & Retries

- `pipeline.newAssignment` throws `Error` with descriptive messages (missing ffmpeg, Notion token, validation failure, etc.). Catch these inside your worker and decide whether to retry or fail the job.
- Use `pipeline.getAssignmentStatus(mdPath)` for status endpoints.
- For partial reruns (e.g., upload only), call `pipeline.rerunAssignment({ md, steps: ['upload'], upload: 's3' })`.

### Step 8 – Containerization

- Build the orchestrator image locally:
  ```bash
  pnpm --filter @esl-pipeline/orchestrator docker:build
  pnpm --filter @esl-pipeline/orchestrator docker:run -- --version
  ```
- In your backend repo, create your own Dockerfile that either extends `esl-pipeline/orchestrator:local` or replicates its pattern (install, workspace build, orchestrator build).
- Always run dry-run smoke tests within the container before promoting to higher environments.

### Step 9 – CI / CD

Ensure your CI executes:
```bash
pnpm --filter @esl-pipeline/orchestrator test -- --runInBand
pnpm --filter @esl-pipeline/orchestrator/examples/service vitest run
pnpm --filter @esl-pipeline/orchestrator docker:build
```

Release flow (using Changesets):
1. `pnpm changeset`
2. Merge; CI runs tests + docker build.
3. `pnpm changeset version` + `pnpm install`
4. `pnpm publish --filter @esl-pipeline/orchestrator --access public`
5. Tag (`git tag vX.Y.Z && git push --tags`).

---

## 3. Environment Quick Reference

| Variable | Purpose |
|----------|---------|
| `NOTION_TOKEN` | Notion API access. |
| `NOTION_DB_ID`, `NOTION_DATA_SOURCE_ID` | Optional overrides for import step. |
| `ELEVENLABS_API_KEY` | Required for TTS. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Required when uploading to S3. |
| `S3_BUCKET`, `S3_PREFIX` | CLI compatibility; use pipeline options for precise control. |
| `ESL_PIPELINE_MANIFEST_STORE` | Set to `s3` to activate the S3 manifest store. |
| `ESL_PIPELINE_MANIFEST_BUCKET` | Target bucket for manifests. |
| `ESL_PIPELINE_MANIFEST_PREFIX` | Optional key prefix (`manifests/prod`). |
| `ESL_PIPELINE_MANIFEST_ROOT` | Base directory used to compute manifest keys. |
| `ESL_PIPELINE_CONFIG_PROVIDER` | Set to `http` to use `RemoteConfigProvider`. |
| `ESL_PIPELINE_CONFIG_ENDPOINT` | Base URL for presets/students/voices endpoints. |
| `ESL_PIPELINE_CONFIG_TOKEN` | Bearer token for the remote config service. |

Load these before you construct the pipeline.

---

## 4. Test Commands

| Command | Description |
|---------|-------------|
| `pnpm --filter @esl-pipeline/orchestrator test -- --runInBand` | Run orchestrator unit/integration tests. |
| `pnpm --filter @esl-pipeline/orchestrator/examples/service vitest run` | Test the Fastify worker. |
| `pnpm --filter @esl-pipeline/orchestrator docker:build` | Build Docker image locally. |
| `pnpm --filter @esl-pipeline/orchestrator docker:run -- --version` | Smoke test the image. |

---

## 5. Future Enhancements (Optional)

1. **Database Manifest Store** – implement `ManifestStore` backed by Postgres/Dynamo; reuse existing interface.
2. **Queue Helper Package** – provide wrappers for BullMQ/SQS/Cloud Tasks with sane defaults.
3. **SecretProvider Interface** – abstract away `.env` in favor of cloud secret managers.
4. **Tenant-aware ConfigProvider** – fetch presets/students per tenant from your DB.
5. **Extended Observability** – export OpenTelemetry traces for stage timing.

These can be layered on without modifying the core pipeline.

---

## 6. Summary

- The orchestrator is backend-ready: adapters, observability, Docker image, service skeleton, CI, and release tooling are all in place.
- Follow the checklist above to embed it in your queue/worker environment.
- Keep dry-run mode on while wiring credentials, then gradually enable import/TTS/upload.
- Use the provided tests, Docker build, and documentation as guardrails to avoid regressions.

With these instructions you should be able to drop the ESL pipeline into a running backend without surprises.
