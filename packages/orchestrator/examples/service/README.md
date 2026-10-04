# Example: HTTP Service Wrapper

This Fastify-based example exposes a simple `/jobs` endpoint that invokes the orchestrator pipeline.
It always runs with `dryRun: true` and skips import/TTS/upload so you can exercise the job flow
without publish-service or cloud-storage credentials. The request must carry AssignmentV1 JSON and a stable `md` manifest locator. Historical Markdown
input is read-only and cannot execute.

## Run locally

```bash
# Install workspace dependencies (repo root)
pnpm install
pnpm --filter @esl-pipeline/orchestrator build
PIPELINE_CWD=$(pwd)/packages/orchestrator/examples/service/fixtures \
  node packages/orchestrator/examples/service/server.ts
```

POST a job:

```bash
curl -X POST http://localhost:8080/jobs \
  -H 'Content-Type: application/json' \
  --data-binary @job.json
```

`job.json` contains `{ "md": "lesson.json", "assignment": <AssignmentV1 JSON> }`. The locator
need not exist as a source file.

### Queue/worker integration

In production you would fetch jobs from a queue and pass a `jobId` alongside the pipeline payload.
The orchestrator already accepts injected `logger`, `metrics`, and `runId` so the queue worker can
emit structured telemetry per job:

```ts
import StatsD from 'hot-shots';
import pino from 'pino';

const statsd = new StatsD();
const pipeline = createPipeline({
  logger: { log: (event) => pino().info(event, event.message) },
  metrics: {
    timing: (metric, value, tags) => statsd.timing(metric, value, tags),
    increment: (metric, value, tags) => statsd.increment(metric, value, tags),
  },
});

queue.process(async (job) => {
  await pipeline.newAssignment(job.payload, undefined, { runId: job.id });
});
```

The sample sticks to `noopLogger`/`noopMetrics` to keep dependencies minimal—swap in your preferred
observability tooling when embedding this pattern in a real worker.

## Tests

```bash
pnpm build
pnpm --dir packages/orchestrator/examples/service test
```
