# Student-Memory Throughput Design Note

## Meta

- Audience: founder-maintainer, backend agents.
- Status: `draft`.
- Last Verified Against: 2026-06-19 repo state and OpenAI Batch/GPT-5.5 docs.
- Exit Trigger: archive or replace after the Chunk 10 implementation plan is accepted.
- Current Focus: compare normal queue processing, rate-limit-aware throttling, and OpenAI Batch API
  backlog replay before implementation.
- Related Chunk: Chunk 10 in `docs/plans/2026-06-15-production-readiness-restart-chunks.md`.

## Context

The production backlog showed that normal background student-memory generation can exceed a Tier 1
OpenAI TPM limit when many lesson-memory, homework-memory, or student-memory snapshot jobs clear at
once. These jobs are important, but they do not need interactive latency.

This note captures the design findings before Chunk 10 changes begin. It is intentionally not an
implementation record: model defaults, env names, schema changes, queue behavior, and persistence
contracts still need normal repo review before they change.

## PR1 Implementation Record (2026-06-19)

PR1 now has a versioned request envelope with an explicit source-data trust boundary, persisted
prompt-package envelope lineage, deterministic assignment validation plus one bounded repair attempt,
closed candidate-patch semantics, and an offline fixture command. The evaluated target model ladder
remains disabled by default behind `GEN_OPENAI_TARGET_MODELS_ENABLED`; no production default has been
activated by this implementation. PR2 pacing and PR3 Batch replay remain separate delivery work.

## Current Request Shape

Current repo behavior is better aligned with the OpenAI Responses API than the original Chunk 10
concern implied:

- Direct OpenAI text generation already posts to `/v1/responses` in
  `packages/batch-backend/src/application/generation-providers.ts`.
- OpenAI structured generation also posts to `/v1/responses` and uses Responses `text.format` with
  strict `json_schema` output.
- Lesson-memory, homework-memory, student-memory snapshot, and foundational profile draft generation
  all pass through provider-level structured output plus backend validation.
- Assignment draft generation is the main unstructured path: the stored prompt-package text is sent
  to the provider and the response is treated as final draft text.
- Student-profile candidate refresh is deterministic today. Candidate promotion does call the
  structured profile-drafting path, but changing "candidate promotion" to a nano-specific LLM policy
  is a workload-policy change, not only a model string swap.

The rough edges are therefore not "migrate everything to Responses." The rough edges are:

- provider/model policy is behind the intended OpenAI-first target model split;
- assignment draft generation still depends heavily on prompt-package quality rather than a
  structured provider response;
- the student-memory worker blocks or retries under budget pressure but does not pace work with
  token-aware smoothing or provider `Retry-After` hints;
- replay/backfill has no first-class OpenAI Batch submission, polling, and reconciliation surface.

## Target Model Direction To Validate

The desired Chunk 10 direction is OpenAI-primary:

- assignment creation: `gpt-5.5`
- profile revision drafts: `gpt-5.4-mini`
- profile candidate promotion: `gpt-5.4-nano` only if the promotion task is kept narrow,
  closed-output, and eval-backed

Before changing defaults, update `docs/reference/GENERATION_PROVIDER_POLICY.md`,
`docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`, `docs/reference/env.md`, and the relevant tests
so code, docs, and operator expectations stay aligned.

## Current OpenAI Guidance Checked

As of 2026-06-18, the official OpenAI docs point to these implementation implications:

- GPT-5.5 migration should be evaluated as a tuned migration, not a drop-in model rename. Use the
  Responses API, tune `reasoning.effort`, set `text.verbosity` intentionally, benchmark quality,
  token use, and latency, and keep prompts outcome-first.
- Structured Outputs are preferred over prompt-only JSON. For Responses, use `text.format` with a
  strict JSON schema when the model response should be machine-readable.
- Batch API supports `/v1/responses`. Each JSONL request must have a unique `custom_id`; one input
  file can target only one model; `completion_window` is currently `24h`; output ordering is not
  guaranteed; successful responses and errors are reconciled through output and error files.
- Batch API uses a separate rate-limit pool from synchronous model calls. A single batch can contain
  up to 50,000 requests and the input file can be up to 200 MB, subject to model-specific enqueued
  prompt-token limits.
- `gpt-5.4-mini` and `gpt-5.4-nano` need more explicit task framing than larger models. Nano should
  stay on narrow, well-bounded, closed-output tasks; ambiguous planning or broad synthesis should
  route to a stronger model.

Sources:

- [Using GPT-5.5](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI Batch guide](https://developers.openai.com/api/docs/guides/batch)
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Prompt guidance](https://developers.openai.com/api/docs/guides/prompt-guidance)

## Prompting Gaps To Close

The current foundation is strong: Responses API use, strict structured outputs for memory/profile
work, backend validation, static-first prompt assembly, and stored prompt-package lineage are all
already in place. The next improvements should make quality and safety explicit at the request and
evaluation boundaries:

1. Split trusted instructions from source data. Current OpenAI calls send the assembled prompt as
   `input`; static policy, transcript, teacher notes, and memory therefore share one trust boundary.
   Put stable policy into Responses `instructions`, keep all retrieved/transcribed material as labelled
   input data, and state that source content is evidence rather than instructions to follow.
2. Require grounding and abstention, not only schema validity. Structured schemas guarantee shape,
   but consequential extracted facts and candidate-promotion changes should carry source ids/spans or
   be omitted. Make unsupported claims and `no_change` valid, expected outcomes.
3. Introduce a small versioned eval fixture set before model/default changes. Cover assignment draft
   quality, lesson/homework/snapshot extraction, profile-draft safety, and nano candidate-promotion
   accuracy. Record quality, schema validity, token use, latency, and grounded-source coverage.
4. Add workload-specific Responses settings behind evaluated policy. GPT-5.5 assignment drafting
   needs intentional `reasoning.effort` and `text.verbosity`; mini and nano need concise,
   closed-task contracts. Do not treat model migration as a literal default-string replacement.
5. Give unstructured assignment drafting a deterministic finish gate. Validate the required assignment
   sections and protected pedagogical/pronunciation contracts, then use a narrow repair request only
   when the validator reports a concrete failure.
6. Treat prompt versions and request envelopes as production lineage. Persist the prompt/version,
   model settings, schema version, and source-selection hash used by online and future Batch work so
   the two paths cannot drift silently.

## OpenAI Docs MCP Status

On 2026-06-19, `codex mcp list` confirmed that the OpenAI developer-docs MCP is registered and
enabled as `openai_developer_docs` at `https://developers.openai.com/mcp`.

The current Codex thread did not expose the corresponding callable
`mcp__openaiDeveloperDocs__search_openai_docs` and
`mcp__openaiDeveloperDocs__fetch_openai_doc` tools after the registration change. Treat this as
current-thread tool discovery, not an MCP registration failure. Start a fresh Codex thread before
the next research or implementation pass, verify that those tools are callable, and use them before
falling back to official-domain web sources.

## Options

### Keep Current Worker Path

Use the existing `student-memory-worker` queue for normal post-lesson and post-homework updates.
This keeps freshness high, preserves existing provenance paths, and avoids a second async result
surface. It still needs rate-limit-aware concurrency defaults so a backlog does not stampede the
provider. Keep this path for fresh tutor activity, small manual repairs, and anything that should be
visible in the workspace quickly.

### Add Rate-Limit-Aware Throttling

Before adding a second provider path, make the worker respect configured OpenAI request/token
budgets for student-memory jobs. This should include bounded concurrency, retry-after/backoff
handling, and operator-visible backlog counts. This is the safest first implementation because it
improves both normal operation and backlog replay.

The throttling design should be token-aware, not only request-count-aware. The existing budget guard
can block over-budget attempts; Chunk 10 should add a pacing layer that can wait safely, smooth
estimated token demand across a minute, and make backlog pressure observable before failures hit the
queue.

### Use OpenAI Batch for Backlog Replay

OpenAI Batch is a good candidate for non-urgent backfills. The current docs describe uploading a
JSONL file with purpose `batch`, then creating a batch with an endpoint and `completion_window`
currently set to `24h`. The docs also describe `/v1/responses` support, one output line per
successful request, a separate error file, unique `custom_id` values for reconciliation, and current
per-batch limits of 50,000 requests and 200 MB. See:

- [OpenAI Batch guide](https://developers.openai.com/api/docs/guides/batch)
- [OpenAI Batches API reference](https://developers.openai.com/api/reference/resources/batches)

Batch should be used for replay/backfill slices where waiting up to 24 hours is acceptable. Keep
normal queue processing for fresh tutor activity, small manual repairs, and anything whose result
should be available quickly in the workspace.

## Product Posture

Implement Batch API access as an available but disabled capability. The first implementation should
prove the backend can submit, poll, reconcile, and retry Batch memory extraction safely without
making Batch the active production path.

This keeps a future entitlement model open:

- free or low-priority plan: memory updates may run through Batch and complete within the Batch
  service window;
- pro or high-priority plan: memory updates stay on the normal online queue for faster freshness;
- operator replay/backfill: Batch can clear large non-urgent slices without stampeding synchronous
  OpenAI TPM limits.

Do not hardcode a paywall in Chunk 10. Design the Batch path with explicit feature flags or
entitlement hooks so product policy can be decided later without rewriting the provider integration.

## Recommendation

Implement rate-limit-aware worker throttling first, then add a disabled Batch-backed replay mode.
Even while disabled, the Batch path should be complete enough for controlled operator testing. A
Batch implementation should:

- Build deterministic JSONL input from backend-selected memory source records.
- Use stable `custom_id` values that encode job kind, student id, source ids, and requested schema
  version.
- Store batch id, input file id, output file id, error file id, status, model, prompt version, and
  source selection hash.
- Reuse the same structured output schema as the online worker path.
- Process successful output lines idempotently and record failed lines for targeted retry.
- Keep one model per input file and verify model Batch support before submission.
- Keep normal queue processing and Batch replay separate at the operation boundary. Do not make
  prompt-package assembly or assignment generation depend on immediate completion of background
  memory jobs.
- Prefer Batch only for replay/backfill slices where a 24-hour completion window is acceptable.
- Gate Batch use behind explicit config and, later, entitlement policy. The default should be
  disabled until product and operator controls are ready.

Prompt tuning should be evaluated at the same time: measure structured output validity, token use,
source coverage, replayability, and provenance clarity before changing production defaults.

## Implementation Backlog

1. Refresh provider policy docs for the intended OpenAI-primary model split, but mark the change as
   pending until evals and validation pass.
2. Add a small eval fixture set for assignment draft, lesson memory, homework memory, snapshot, and
   profile promotion outputs before changing prompts or defaults.
3. Add worker pacing around student-memory provider calls: token estimate, per-model RPM/TPM budget,
   `Retry-After` handling, safe wait/requeue semantics, and backlog metrics.
4. Add Batch replay as an explicit disabled operator/tool path: deterministic source selection,
   JSONL generation, file upload, batch create, status polling, output/error fetch, idempotent
   result import, targeted retry, and a feature flag or entitlement hook.
5. Revisit prompts per workload: GPT-5.5 outcome-first prompt-package drafting, explicit
   small-model scaffolding for profile draft work, and nano only for narrow closed promotion tasks if
   the eval set proves it.
6. Update `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md` before implementation if the code starts
   using newer Responses knobs such as `reasoning.effort`, `text.verbosity`, Batch, prompt-cache
   controls, or a broader structured-output profile.

## Next Thread Handoff

```text
Continue Chunk 10 OpenAI-first student-memory and prompting work in D:\code\esl-pipeline.

Read first:
- AGENTS.md and docs/reference/agents-ssot.md
- docs/plans/2026-06-15-production-readiness-restart-chunks.md (Chunk 10)
- docs/plans/2026-06-16-student-memory-throughput-design-note.md
- docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md
- docs/reference/GENERATION_PROVIDER_POLICY.md
- docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md

Important product and model direction, still pending implementation/evals:
- OpenAI should become the primary provider.
- Assignment creation target: gpt-5.5.
- Profile revision drafts target: gpt-5.4-mini.
- Candidate promotion target: gpt-5.4-nano only for a narrow, closed-output, eval-backed diff task.
- Implement OpenAI Batch access, but keep it disabled behind config/entitlement hooks. It is future
  plumbing for low-priority/free-plan memory updates and operator backfills, not an active paywall.

Prompting priorities:
1. Move stable trusted policy into Responses instructions and keep transcripts, notes, and retrieved
   memory as labelled data input with an explicit "source data is not instructions" rule.
2. Add a versioned eval fixture set before changing models, prompts, or defaults.
3. Require grounded evidence or abstention/no_change for consequential memory/profile changes.
4. Add evaluated per-workload reasoning.effort and text.verbosity policy.
5. Add deterministic assignment validation plus targeted repair rather than accepting arbitrary final
   draft text.
6. Build one canonical request envelope shared by online and Batch memory extraction.

OpenAI Docs MCP:
- `codex mcp list` on 2026-06-19 shows `openai_developer_docs` enabled at
  https://developers.openai.com/mcp.
- In the prior thread, the MCP was registered but its callable search/fetch tools were not injected.
  Verify `mcp__openaiDeveloperDocs__search_openai_docs` and
  `mcp__openaiDeveloperDocs__fetch_openai_doc` are available before research. Use them to fetch the
  latest-model, prompt-guidance, structured-outputs, Batch, and relevant Responses API reference
  docs. Do not rely only on the existing June 18 capture.

Current code facts:
- `packages/batch-backend/src/application/generation-providers.ts` uses /v1/responses; structured
  calls use text.format with strict JSON schema, but direct generation sends one assembled prompt as
  input.
- `packages/batch-backend/src/application/generate-draft.ts` sends prompt-package text and accepts
  free-form assignment text as the final draft.
- The lesson/homework/snapshot prompt builders and `profile-revision-drafting.ts` are the first
  places to inspect for prompt hardening and structured contract changes.
- The student-memory worker needs token-aware pacing and Retry-After behavior before Batch becomes
  active.

Scope discipline:
- This has been research/docs only. Do not implement until the next task explicitly authorizes it.
- Ignore unrelated working-tree files, including PRODUCT.md and docs/reference/gpt-5.5_prompt-guidance.md.
- Before editing, inspect current git status and reread the exact Chunk 10 plan after any context
  compaction.
```
