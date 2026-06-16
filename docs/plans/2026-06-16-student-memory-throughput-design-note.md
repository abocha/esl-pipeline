# Student-Memory Throughput Design Note

## Meta

- Audience: founder-maintainer, backend agents.
- Status: `draft`.
- Last Verified Against: 2026-06-16 repo state and OpenAI Batch API docs.
- Exit Trigger: archive or replace after the Chunk 10 implementation plan is accepted.
- Current Focus: compare normal queue processing, rate-limit-aware throttling, and OpenAI Batch API
  backlog replay before implementation.
- Related Chunk: Chunk 10 in `docs/plans/2026-06-15-production-readiness-restart-chunks.md`.

## Context

The production backlog showed that normal background student-memory generation can exceed a Tier 1
OpenAI TPM limit when many lesson-memory, homework-memory, or student-memory snapshot jobs clear at
once. These jobs are important, but they do not need interactive latency.

## Options

### Keep Current Worker Path

Use the existing `student-memory-worker` queue for normal post-lesson and post-homework updates.
This keeps freshness high, preserves existing provenance paths, and avoids a second async result
surface. It still needs rate-limit-aware concurrency defaults so a backlog does not stampede the
provider.

### Add Rate-Limit-Aware Throttling

Before adding a second provider path, make the worker respect configured OpenAI request/token
budgets for student-memory jobs. This should include bounded concurrency, retry-after/backoff
handling, and operator-visible backlog counts. This is the safest first implementation because it
improves both normal operation and backlog replay.

### Use OpenAI Batch for Backlog Replay

OpenAI Batch is a good candidate for non-urgent backfills. The current docs describe uploading a
JSONL file with purpose `batch`, then creating a batch with an endpoint and `completion_window`
currently set to `24h`. The docs also describe one output line per successful request, a separate
error file, unique `custom_id` values for reconciliation, and current per-batch limits of 50,000
requests and 200 MB. See:

- [OpenAI Batch guide](https://developers.openai.com/api/docs/guides/batch)
- [OpenAI Batches API reference](https://developers.openai.com/api/reference/resources/batches)

Batch should be used for replay/backfill slices where waiting up to 24 hours is acceptable. Keep
normal queue processing for fresh tutor activity, small manual repairs, and anything whose result
should be available quickly in the workspace.

## Recommendation

Implement rate-limit-aware worker throttling first, then add a Batch-backed replay mode if backlog
operations remain painful. A Batch implementation should:

- Build deterministic JSONL input from backend-selected memory source records.
- Use stable `custom_id` values that encode job kind, student id, source ids, and requested schema
  version.
- Store batch id, input file id, output file id, error file id, status, model, prompt version, and
  source selection hash.
- Reuse the same structured output schema as the online worker path.
- Process successful output lines idempotently and record failed lines for targeted retry.
- Keep one model per input file, then verify endpoint/model support before coding.

Prompt tuning should be evaluated at the same time: measure structured output validity, token use,
source coverage, replayability, and provenance clarity before changing production defaults.
