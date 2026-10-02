# Generation Target Policy

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 5 minutes.
- Authority Level: canonical workload target and quota policy.
- Last Verified Against: 2026-10-02 ABO-9 implementation.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after provider policy/availability changes.
- Status: `reference`.

## Explicit workload targets

`resolveGenerationTarget()` resolves one `{ provider, model }`. Failures never select a different
model or provider. Assignment/profile generation makes one physical request and returns a normalized
failure; existing durable queues own background retries. Assignment generation requires strict AssignmentV1 on OpenAI GPT-6.1 Sol, admits completed
non-refusal direct JSON, validates locally and deterministically renders PMD. Unsupported assignment
overrides fail before dispatch. There is no model-driven Markdown repair. See
[AssignmentV1](ASSIGNMENT_V1.md) for prompt cutover and compatibility boundaries.

| Workload                                                | Provider default | Model default  | Exact env target                                                            |
| ------------------------------------------------------- | ---------------- | -------------- | --------------------------------------------------------------------------- |
| Assignment draft                                        | `openai`         | `gpt-6.1-sol`  | `GEN_ASSIGNMENT_PROVIDER`, `GEN_ASSIGNMENT_MODEL`                           |
| Lesson memory                                           | `openai`         | `gpt-5.6-luna` | `GEN_LESSON_MEMORY_PROVIDER`, `GEN_LESSON_MEMORY_MODEL`                     |
| Homework memory                                         | `openai`         | `gpt-5.6-luna` | `GEN_HOMEWORK_MEMORY_PROVIDER`, `GEN_HOMEWORK_MEMORY_MODEL`                 |
| Student-memory snapshot                                 | `openai`         | `gpt-5.6-luna` | `GEN_STUDENT_MEMORY_SNAPSHOT_PROVIDER`, `GEN_STUDENT_MEMORY_SNAPSHOT_MODEL` |
| Profile revision / candidate patch / initial enrichment | `openai`         | `gpt-5.6-luna` | `GEN_PROFILE_DRAFT_PROVIDER`, `GEN_PROFILE_DRAFT_MODEL`                     |

Explicit provider/model request overrides remain available for workloads whose admission policy supports them. Model-only overrides use the workload's
provider. Provider-only overrides use its configured workload model when the provider matches, or
`GEN_OPENAI_MODEL` (Luna), `GEN_GOOGLE_MODEL` (Gemini 3 Flash Preview), or `GEN_OPENROUTER_MODEL`
when switching provider. A missing OpenRouter model fails before execution; its adapter is retained
for explicit use only. No provider roster order represents automatic routing.

Memory enqueue, confirmation, backfill, and lesson-history refresh consumers resolve the appropriate
lesson/homework/snapshot target before storing the pending intent. Workers continue to execute the
provider/model already stored in the job; deployment does not retarget existing jobs or historical
records. Profile initial enrichment also freezes its target in the existing operation record and
retains its submission/recovery lifecycle.

Versioned request envelopes still own OpenAI reasoning and verbosity: assignment medium/medium,
lesson/homework/profile medium/low, snapshot high/low. AssignmentV1 pins its schema in the existing envelope; memory/profile schemas remain unchanged.
ABO-6 prompt bootstrap and admin activation remain separate from deployment.

### Explicit model rosters

`GEN_ALLOWED_MODELS_*` remains an explicit selection roster for job options and an independent
access guard for default-off OpenAI Batch replay, speech-planner availability, and live speech
evaluation. It never appends models to an execution target. Ordinary generation has no legacy
strict-no-paid allowlist gate. Authenticated operator controls and provider budgets remain intact.
OpenRouter appears as an explicit UI choice only when an operator configures its model/roster or
assignment target; adapter existence alone does not expose a routing option.

Google's roster preserves Gemini 3 Flash Preview, 3.1 Pro Preview, 3.5 Flash, 3.1/3.5 Flash Lite,
2.5 Pro/Flash/Flash Lite, and Gemma 4 31B/26B. No Google workload or historical selection is migrated
to OpenAI by this cleanup. The live inventory and rollout procedure below own env translation.

### Independent explicit generation consumers

Voice-plan ranking already selects exactly Google AI Studio with
`ESL_TTS_VOICE_RANKER_MODEL` (default `gemma-4-31b-it`) and its own enablement/capacity controls.
It calls the raw structured adapter once; ranking failure uses the existing deterministic voice
selection rather than trying another provider/model. Speech planning below owns its independent
target and identity-plan recovery. These product capabilities remain separate from assignment and
memory routing. Disabled OpenAI Batch replay and optional fixture/live evaluators are explicit
operator lanes, not automatic routing consumers.

### Study-text speech planning

- The production speech planner remains disabled until explicitly enabled. Its built-in selection
  is exact `openai` plus `gpt-5.6-luna`; Google models are explicit overrides and historical
  evaluation targets.
- Speech planning selects exactly one provider and never crosses providers on retry or failure.
  Google uses `GEMINI_API_KEY`; OpenAI uses `OPENAI_API_KEY`, strict structured output, high
  reasoning, low verbosity, and `store: false`.
- The official OpenAI API pricing page listed standard short-context Luna pricing as $0.20 per
  million input tokens, $0.02 per million cached input tokens, and $1.20 per million output tokens
  on 2026-08-01. Treat that dated snapshot as decision evidence, not a permanent price contract.
- The organization currently opts into API input/output sharing. Under OpenAI's 2026-08-01 Tier 1
  complimentary-token terms, the shared model group containing GPT-5.6 Luna and Terra has a 2.5
  million-token daily allowance; the group containing GPT-5.6 Sol has a separate 250,000-token
  daily allowance. These external allowances reset at 00:00 UTC and are operator-verified inputs,
  not hardcoded application entitlements. Retain local request, token, and spend guards because
  offer eligibility and terms may change.
- Data sharing is an operator-controlled governance decision. Synthetic evaluation inputs are
  eligible for the bounded trial; learner or other sensitive, confidential, or proprietary content
  must be shared only when the organization has the necessary permission and policy basis.
- Provider/model RPM, daily requests, daily tokens, and spend accounting remain separate. Each
  typed-timeout retry reserves another physical request before execution; actual returned usage is
  recorded once for the successful logical call.
- Prompt policy `contextual-bracket-annotation-v1` gives Luna complete dialogue or monologue
  assignment context and returns only optional reserved annotations inserted into immutable spoken
  segments. Pronunciation is excluded. Historical v1/v2 evaluation results are not reclassified as
  replacement schema-v2 or Luna listening evidence.

## Quota UX Mode

- `hybrid`
  - configured limits from backend
  - local usage counters from app telemetry
  - provider dashboard remains operator truth

## Runtime rules and retry ownership

- Provider adapters use raw HTTP with configurable `GEN_*_REQUEST_TIMEOUT_MS` (default 240000 ms).
  There is no SDK retry layer. Assignment/profile generation does not retry locally.
- Normalized errors remain `provider_rate_limit`, `provider_timeout`, `provider_contract_error`,
  and `budget_exceeded`; provider/model provenance, request IDs and returned usage remain available.
- Canonical lesson/homework/snapshot jobs retain the existing durable BullMQ lifecycle. Minute
  RPM/TPM limits and HTTP 429 defer the original job with its frozen target. They do not sleep a
  worker, enqueue a duplicate, or switch targets. Other failure and recovery semantics are unchanged.
- Initial profile enrichment retains its existing durable submission pacing and uncertain-submission
  recovery; it does not retry the provider call inside profile drafting.
- Speech planning independently uses one target and bounded typed-timeout retries controlled by
  `GEN_OPENAI_RETRY_*` / `GEN_GOOGLE_RETRY_*`. Its single-candidate use of the shared provider-runtime
  helper cannot switch targets. The shared ladder remains for independent TTS adapter behavior;
  ABO-9 does not redesign TTS.
- `GEN_SAFETY_MODE=hard_stop` retains atomic provider/model budget reservation, UTC rollover and
  actual usage accounting. `0` budgets remain intentional blocks. `off` / `warn` preserve their
  existing bypass behavior for capacity limits. `GEN_MAX_OUTPUT_TOKENS_HARD=12000` is enforced
  regardless of that mode; the removed paid-spend switch cannot bypass it.
- `/config/job-options` exposes assignment choices and quotas without candidate ranks or tiers.

## Disabled OpenAI Batch Replay

- Historical lesson-memory, homework-memory, and snapshot replay may use the OpenAI Batch API only
  through the explicit `student-memory:batch` operator tool. It is not a fresh-work, fallback, or
  automatic queue path.
- `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false` is the separate default-off gate. It must not be
  replaced with or inferred from generation target settings.
- `dry-run` is local and non-persistent. Every remote action requires the Batch gate, an OpenAI key,
  an allowlisted model, and explicit `--apply` for submit, retry, or cancellation.
- This policy does not authorize provider calls, activation, or deployment. Those remain separate
  maintainer decisions after code review.

## ABO-9 rollout: translate and remove obsolete env

Deployment and production env changes require separate operator authorization. No production mutation
was performed during implementation. Before rollout, inspect the current effective API and worker
settings and pending targets, rather than copying an older inventory blindly.

Read-only production inventory on 2026-10-02 found assignment selections on OpenAI (`gpt-5.6-sol`
and `gpt-6.1-sol`) and Google `gemini-3-flash-preview` records for lesson memory (341), homework
memory (399), and snapshots (723), alongside older/current OpenAI records. The server env selected
OpenAI as default, Google Gemini 3 Flash Preview as primary, and no OpenRouter assignment/memory
selection appeared in the queried records. The speech planner was explicitly enabled on OpenAI
Luna and voice ranking was enabled on Google `gemma-4-31b-it`; preserve these independent targets. These counts describe retained records, not current
traffic or success rates. Google adapters, explicit overrides, and frozen jobs remain supported.

1. Capture current effective targets, including any explicit request overrides. Translate each
   workload's intentional first target to the five `GEN_<WORKLOAD>_PROVIDER/MODEL` pairs above.
   OpenAI assignment defaults to Sol 6.1; other OpenAI workloads default to Luna 5.6. For an
   intentionally Google workload set its provider to `google_ai_studio` and model to its existing
   exact model, such as `gemini-3-flash-preview`. Do not replace a Google workload by copying the
   OpenAI example. Preserve historical/pending record targets; no data migration is needed.
2. Translate provider-only debug defaults to `GEN_OPENAI_MODEL`, `GEN_GOOGLE_MODEL`, and, if
   explicitly needed, `GEN_OPENROUTER_MODEL`. Keep provider credentials, timeouts, capacity budgets,
   explicit rosters, speech settings and the separate default-off Batch gate.
3. Delete `GEN_PROVIDER_DEFAULT`, `GEN_PROVIDER_FALLBACKS`, `GEN_OPENAI_TARGET_MODELS_ENABLED`,
   `GEN_STRICT_NO_PAID`, `GEN_ALLOW_PAID_SPEND`, `GEN_OPENAI_MODEL_PRIMARY`,
   `GEN_OPENAI_MODEL_FALLBACK`, `GEN_OPENAI_MODEL_ASSIGNMENT_DRAFT_PRIMARY`,
   `GEN_OPENAI_MODEL_STUDENT_MEMORY_PRIMARY/FALLBACK`,
   `GEN_OPENAI_MODEL_PROFILE_DRAFT_PRIMARY/FALLBACK/TERTIARY`,
   `GEN_GOOGLE_MODEL_PRIMARY/FALLBACK/TERTIARY`, `GEN_OPENROUTER_MODEL_PRIMARY/FALLBACK`, and
   `GEN_OPENROUTER_RETRY_MAX/BACKOFF_MS`. Slash suffixes here enumerate distinct variable names.
   These variables are ignored, not compatibility aliases. The inspected server currently contains
   provider fallback, target-model flag, Google ladder, strict-no-paid/paid-spend switches and
   OpenRouter retry settings that must be removed. Retain the rosters because they serve explicit
   selection/Batch/planner controls.
4. Check `GEN_SAFETY_MODE` deliberately. The inspected server uses `off`,
   `GEN_STRICT_NO_PAID=false`, and `GEN_ALLOW_PAID_SPEND=true`. Preserve `off` if that is the
   operator's intended capacity policy; it no longer disables the max-output cap. Check requested
   output limits against the retained cap before rollout. Do not enable `hard_stop` blindly with
   example budgets. No new paid-spend replacement switch is needed.
5. Use the standard immutable-image deployment procedure, then verify effective targets in both
   API and workers and assignment metadata. Verify existing Google pending work retains its target
   without making an unapproved paid smoke call. On rollback restore the previous env snapshot with
   the previous image together; old images require old settings. Do not restore obsolete env
   settings while keeping the new image.

## Implementation Expectations

- `/config/job-options` exposes provider/model/quota metadata
- `POST /generation/drafts` may accept provider/model overrides
- responses must retain provider/model/quota context for auditability
- preset semantics and provider semantics must stay decoupled
- student-memory extraction capability is governed separately by
  [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
- Evaluators are optional diagnostic/evaluation tooling, not merge or activation gates.
  Offline fixtures can be inspected with:
  `pnpm exec tsx --tsconfig packages/batch-backend/tsconfig.json packages/batch-backend/src/tools/evaluate-generation-fixtures.ts`
- Optional live evaluation requires explicit paid-provider authorization and the opt-in flag:
  set `GENERATION_LIVE_EVAL_ENABLED=true` and invoke that tool with `--live`

## Detailed Provider References

- [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
- [`docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
- [`docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`](OPENAI_RESPONSES_WS2B_PROFILE.md)
- [`docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`](GOOGLE_GENAI_WS2B_PROFILE.md)
- [`docs/reference/OPENROUTER_WS2B_PROFILE.md`](OPENROUTER_WS2B_PROFILE.md)
- [`docs/reference/env.md`](env.md)
