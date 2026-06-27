# Student-Memory Throughput Design Note

## Meta

- Audience: founder-maintainer and implementation agents.
- Status: `archive`.
- Last Verified Against: 2026-06-23 Chunk 10 completion and live-eval state.
- Related Chunk: historical Chunk 10 record in
  `docs/archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md`.
- Completion: PR1 (#110), PR1.1 (#111), PR2 (#112), and PR3 (#113) are merged. The original
  patch-labelled release is `v9.1.10`; this closeout PR carries the intended `release:minor`
  classification without rewriting that release.

## Decision Snapshot

Chunk 10 keeps normal online student-memory generation for fresh work, adds rate-limit-aware pacing
in PR2, and later adds OpenAI Batch only for non-urgent replay/backfill in PR3. Batch remains
disabled until its operator and product controls are implemented.

PR1, PR1.1, PR2, and PR3 are merged. PR3's disabled operator implementation remains unactivated.
Do not deploy these changes to production or enable
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
`tmp/generation-evals/live-eval-2026-06-23.json`:

- All six workloads passed; there were no provider, schema, grounding, assignment-validation,
  injection, or completeness failures.
- Assignment requested `gpt-5.5`, returned `gpt-5.5-2026-04-23`, passed strict v2 validation and
  injection evaluation, used 9,605 tokens, and took 46,644 ms.
- Lesson memory, homework memory, snapshot, foundational profile, and candidate patch passed their
  schema/grounding/injection checks and completed normally on their evaluated model revisions.
- Aggregate observed usage was 12,763 tokens and 55,590 ms summed latency.

This qualifies the harness as a live activation gate. Target-model activation and production
deployment remain separate maintainer approvals.

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

Batch is for explicit, non-urgent replay/backfill only. The fixed 24-hour completion window is
acceptable for this lane; it is not acceptable for fresh tutor-triggered work. The paced online
worker remains the sole fresh-work path.

The implementation-ready plan is
[`tmp/plans/chunk-10-pr3-batch-replay-current-main.md`](../../tmp/plans/chunk-10-pr3-batch-replay-current-main.md).
Its key decisions are:

1. **One immutable workload/model slice.** A slice contains exactly one canonical workload and one
   OpenAI model, with deterministic JSONL/custom-ID order. Lesson and homework can run separately;
   snapshots are selected only after prerequisite memory slices have reconciled.
2. **Snapshots, not later reads.** Each durable item retains its full request envelope, strict
   schema/request body, source references, source-version hash, and stable custom ID. A hash alone
   cannot reproduce or evidence-validate a result received up to 24 hours later.
3. **Online wins.** Batch selection never calls the normal pending/enqueue helpers. A fresh online
   request can supersede the Batch claim immediately; a source-version check makes the eventual
   Batch result terminal `stale` rather than letting it replace current canonical memory.
4. **Atomic idempotent import.** Existing canonical writers create random IDs and supersede ready
   entries, so Batch needs a transaction-aware import boundary with stable destination IDs. A
   repeated reconcile, including after a crash, returns the same canonical record.
5. **Shared Responses semantics.** Online and Batch paths use the same pure `/v1/responses` body
   builder, parser, strict validators, evidence checks, and canonical-write mapping. Batch does not
   recreate a looser provider contract.
6. **Hard disabled gate.** `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false` is a typed, provider-boundary
   gate. Local `dry-run` is non-persistent and makes no provider call; submit/status/poll/reconcile/
   retry/cancel fail before OpenAI access unless the gate is enabled, and submission additionally
   requires `--apply`.
7. **Privacy and retries.** Item snapshots are protected student data with the same Postgres access
   and deletion lifecycle as their student. JSONL/raw output is never durably written or logged.
   Only remote/provider/expiry failures are retryable by default; schema, evidence, malformed,
   unknown/duplicate-ID, and stale results are terminal and auditable.

Current official OpenAI Batch constraints confirm the route: `/v1/responses` is supported; input
files require one model and unique `custom_id`, complete within `24h`, may return unordered output
plus a separate error file, and have 50,000-request/200-MB limits. The implementation must verify
those constraints again against the official docs before code changes.

PR3 is a backward-compatible operator capability and therefore plans for `release:minor`. It does
not add a tutor-facing endpoint, scheduler, automatic entitlement routing, target-model activation,
deployment, or a paid Batch call.

## Completion Record

- PR1 (#110) established the versioned request envelope, validators, and offline evaluator; PR1.1
  (#111) hardened the live evaluator; PR2 (#112) added paced online processing; and PR3 (#113)
  added the disabled Batch replay capability and atomic canonical import.
- PR3 merged under the `release:patch` label and published `v9.1.10`. This documentation closeout
  uses `release:minor` so the normal release workflow publishes the intended `v9.2.0` line; it does
  not alter the existing tag or images.
- The 2026-06-23 live evaluation passed all six workloads. It is evidence for a later activation
  decision, not an activation or deployment action in this PR.
- `STUDENT_MEMORY_OPENAI_BATCH_ENABLED` remains false. No Batch submission, provider call,
  deployment, or production feature-flag change is authorized by this archived plan.

## Guardrails And Handoff

- Do not deploy to Lightsail as part of PR3. Merge is acceptable; enablement/deployment waits for
  separate maintainer approval after implementation and review.
- Do not enable `GEN_OPENAI_TARGET_MODELS_ENABLED` without explicit approval after reviewing the
  relevant evidence.
- Before any new model/prompt/default change, add or update deterministic eval coverage and re-run
  the live gate only with explicit paid-call authorization.
- For the next implementation pass, read `AGENTS.md`, `docs/reference/agents-ssot.md`, this note,
  `docs/reference/GENERATION_PROVIDER_POLICY.md`,
  `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`, and
  `docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`.
