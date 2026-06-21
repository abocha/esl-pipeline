# Student-Memory Throughput Design Note

## Meta

- Audience: founder-maintainer and implementation agents.
- Status: `roadmap`.
- Last Verified Against: 2026-06-21 PR2 pacing implementation and local validation.
- Related Chunk: Chunk 10 in `docs/plans/2026-06-15-production-readiness-restart-chunks.md`.
- Exit Trigger: archive after PR2 pacing and PR3 Batch-replay decisions are shipped or promoted into
  durable runtime and operations documentation.
- Current Focus: validate and merge PR2 rate-limit-aware online pacing; defer PR3 Batch replay and
  all production deployment decisions.

## Decision Snapshot

Chunk 10 keeps normal online student-memory generation for fresh work, adds rate-limit-aware pacing
in PR2, and later adds OpenAI Batch only for non-urgent replay/backfill in PR3. Batch remains
disabled until its operator and product controls are implemented.

PR1, PR1.1, and PR2 implementation are complete. Do not deploy these changes to production yet;
wait until the PR3 design and implementation boundary are settled. Do not enable
`GEN_OPENAI_TARGET_MODELS_ENABLED` without separate maintainer approval.

## What PR1 And PR1.1 Established

PR1 established a versioned generation request envelope, explicit source-data trust boundary,
prompt-package lineage, deterministic assignment validation with one bounded repair, closed
candidate-patch semantics, and an offline evaluator.

PR1.1 made that evaluator a reliable live gate:

- It loads `.env.batch-backend` and `.env` before its API-key guard, while retaining explicit live
  opt-in before any provider request.
- Structured workloads use their production strict schemas and the structured OpenAI execution path.
- Assignment output is checked by `@esl-pipeline/md-validator` with at most one repair.
- Every structured workload has consequential-claim evidence rules; invented source IDs fail.
- Source-data injection is checked from output behavior, not request text.
- Provider, schema, grounding, assignment-validation, injection, and incomplete-report failures
  produce a failed verdict and nonzero live exit.
- Reports retain privacy-safe audit facts only: model, provider request ID, finish reason, settings,
  usage, latency, source-selection hash, safe diagnostics, and verdict.

The validator audit found that `general-english@v1` could report an issue as
`blockingInStrict: true` while accepting it in strict mode. PR1.1 adds `general-english@v2` as the
default: one typed diagnostic policy derives strict escalation, code, severity, category, and
`blockingInStrict`. V1 remains explicitly selectable for persisted jobs. Bare emitted audio/video
directives block v2; omitted optional directives remain valid.

## Requalification Evidence

The previous evaluator was not an activation gate: it used unstructured calls for structured work,
missed canonical validation/grounding coverage, and exited zero despite failures. Its diagnostic
result drove the hardening above; it is not release evidence.

The explicitly authorized passing report is
`packages/batch-backend/tmp/generation-evals/generation-eval-2026-06-20T18-54-33.592Z.json`:

- All six workloads passed; there were no provider, schema, grounding, assignment-validation,
  injection, or completeness failures.
- Assignment requested `gpt-5.5`, returned `gpt-5.5-2026-04-23`, passed strict v2 validation and
  injection evaluation, used 9,788 tokens, and took 81,461 ms.
- Lesson memory, homework memory, snapshot, foundational profile, and candidate patch all returned
  their requested model revisions, passed schema/grounding/injection checks, and completed normally.
- Aggregate observed usage was 13,164 tokens and 92,787 ms latency.

This qualifies the harness and supports PR2. It does **not** authorize target-model activation or
production deployment.

## Current Architecture And Policy

- The backend already uses the OpenAI Responses API. Structured workloads use strict
  `text.format` JSON schemas; assignment drafting remains intentionally free-form markdown behind
  the deterministic finish gate.
- Intended evaluated model direction: assignment `gpt-5.5`, profile revision
  `gpt-5.4-mini`, and candidate patch `gpt-5.4-nano` only for its narrow, closed-output task.
- Stable policy belongs in Responses `instructions`; transcripts, notes, and retrieved memory are
  labelled source data, never instructions.
- Consequential memory/profile claims need evidence or an abstaining/no-change outcome. Prompt and
  request-envelope lineage must remain comparable between online and future Batch paths.

## PR2: Rate-Limit-Aware Online Pacing

The former PR2 outline is superseded where it proposed new TPM configuration and budget counters:
main already has both, including atomic UTC minute/day reservations and actual-usage recording.
PR2 now integrates that existing guard into each canonical lesson, homework, and snapshot
extraction path.

Implement token-aware worker pacing before Batch:

1. Estimate per-job token demand and apply model-aware RPM/TPM budgets.
2. Convert only minute RPM/TPM exhaustion and provider HTTP 429 into a typed defer outcome. Move
   the active BullMQ job to its UTC `notBefore` time and throw BullMQ's `DelayedError`, rather than
   sleeping a worker, enqueuing a duplicate, or consuming a failure attempt.
3. On HTTP 429, defer until the later of the next UTC minute and `Retry-After`; without that
   header, defer until the next UTC minute. Daily limits, hard stops, capability/schema failures,
   validation failures, timeouts, and non-429 provider failures retain normal failure behavior.
4. Preserve the queued provider/model/source selection across a defer. Canonical memory must not
   stampede a fallback provider merely because it is paced.
5. Emit privacy-safe structured defer/completion diagnostics and use the existing metrics facade
   for counts/timings/tokens. A post-success actual-usage accounting outage must preserve the
   completed canonical result (the pre-call reservation remains enforced) and emit a safe failure
   metric rather than re-running the provider call. The facade is currently noop, so logs—not a
   nonexistent dashboard—are the operator-visible evidence.
6. Keep bounded concurrency, normal fresh-work queue behavior, and all PR3 Batch boundaries
   unchanged.

PR2 needs no migration, schema-baseline update, new environment key, public DTO change, paid live
eval, target-model activation, or deployment.

## PR3: Disabled Batch Replay

Batch is for non-urgent replay/backfill, where the current 24-hour completion window is acceptable.
It must stay a disabled capability, not an active paywall or replacement for fresh online work.

PR3 needs deterministic JSONL input; one model per batch; stable `custom_id`; persisted batch/file
IDs, status, model, prompt/schema/source-selection lineage; polling; idempotent success import;
error-file handling; targeted retry; and explicit feature/entitlement hooks. Reuse the same
structured schemas as the online path.

## Guardrails And Handoff

- Do not deploy to Lightsail as part of this PR. Merge is acceptable; deployment waits for PR3
  decisions.
- Do not enable `GEN_OPENAI_TARGET_MODELS_ENABLED` without explicit approval after reviewing the
  relevant evidence.
- Before any new model/prompt/default change, add or update deterministic eval coverage and re-run
  the live gate only with explicit paid-call authorization.
- For the next implementation pass, read `AGENTS.md`, `docs/reference/agents-ssot.md`, this note,
  `docs/reference/GENERATION_PROVIDER_POLICY.md`,
  `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`, and
  `docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`.
