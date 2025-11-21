# Example: HTTP Service Wrapper

This Fastify-based example exposes a simple `/jobs` endpoint that invokes the orchestrator pipeline.
It always runs with `dryRun: true` and skips import/TTS/upload so you can exercise the job flow
without Notion or AWS credentials. Point `PIPELINE_CWD` at a directory with Markdown lessons (the
fixtures provided in this workspace work out of the box).

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
  -d '{"md":"lesson.md"}'
```

### Queue/worker integration

In production you would fetch jobs from a queue and pass a `jobId` alongside the pipeline payload.
The orchestrator already accepts injected `logger`, `metrics`, and `runId` so the queue worker can
emit structured telemetry per job:

```ts
import pino from 'pino';
import StatsD from 'hot-shots';

const statsd = new StatsD();
const pipeline = createPipeline({
  logger: { log: event => pino().info(event, event.message) },
  metrics: {
    timing: (metric, value, tags) => statsd.timing(metric, value, tags),
    increment: (metric, value, tags) => statsd.increment(metric, value, tags),
  },
});

queue.process(async job => {
  await pipeline.newAssignment(job.payload, undefined, { runId: job.id });
});
```

The sample sticks to `noopLogger`/`noopMetrics` to keep dependencies minimal—swap in your preferred
observability tooling when embedding this pattern in a real worker.

## Tests

```bash
pnpm --filter @esl-pipeline/orchestrator examples/service vitest run
```