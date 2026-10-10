# Generation Target Policy

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 5 minutes.
- Authority Level: canonical workload target and quota policy.
- Last Verified Against: 2026-10-10 ESL-41 implementation.
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

Fresh LLM requests and maintenance overrides admit `openai` only. Google AI Studio and OpenRouter
adapters, credentials, rosters and limits are retired. Model-only OpenAI overrides remain explicit;
assignment admission still requires GPT-6.1 Sol. Unsupported providers or Gemini/Gemma model
selections fail before dispatch, including frozen jobs. No fallback or automatic retargeting exists.
Public historical provider identifiers and stored request/model/usage evidence remain readable.

Memory enqueue, confirmation, backfill, and lesson-history refresh consumers resolve the appropriate
lesson/homework/snapshot target before storing the pending intent. Workers continue to use the provider/model already stored in the job. Frozen retired-provider
jobs fail explicitly; deployment does not retarget existing jobs or historical records. Profile initial enrichment also freezes its target in the existing operation record and
retains its submission/recovery lifecycle.

Versioned request envelopes still own OpenAI reasoning and verbosity: assignment medium/medium,
lesson/homework/profile medium/low, snapshot high/low. AssignmentV1 pins its schema in the existing envelope; memory/profile schemas remain unchanged.
ABO-6 prompt bootstrap and admin activation remain separate from deployment.

The alpha model decision retains GPT-5.6 Luna for bounded workloads and speech planning;
voice ranking adopts the same target. The maintainer's data-sharing headroom premise is an
operating constraint, not permission to share learner data or a promise of free capacity.
See the [dated model decision and privacy boundary](../operations/openai-llm-migration.md#alpha-model-decision).

### Effective learner-memory inputs (ESL-40)

Lesson/homework memory, full/incremental snapshots, profile refresh, candidate promotion and legacy
profile normalization build one `GenerationRequestEnvelopeV1`, with prompt policy
`learner_memory_generation_v2`. Diagnostic text and token estimation use its instructions plus
two newlines plus input. OpenAI retains separate `instructions`/`input`. Prompt-only initial enrichment and speech
planning retain their existing requests. ESL-40 changed no model, schema, cap, retry or routing policy; ESL-41 changes active targets only.
The estimator retains its existing four-characters-per-token convention and output allowance;
it does not add schema or transport-token overhead. Estimates remain approximations, not billed usage.

The policy consolidates existing instructions: lesson speaker/noise/confidence guidance, snapshot
continuity and review guidance, and durable profile guidance. Candidate promotion keeps ESL-39's
bounded patch decision, replacing the stale full-rewrite text; normalization requests its existing
foundational JSON schema rather than the stale Markdown instruction. Source manifests and envelope
source payloads remain intact. Captured synthetic before requests and reconciled instruction fixtures
live in `packages/batch-backend/tests/fixtures/memory-generation-{before,after}/`.

Historical ESL-40 synthetic before requests retain their Google/OpenRouter bodies as evidence.
The request-capture checks now exercise only OpenAI and keep instructions, source bytes, schemas,
caps and envelope settings pinned. ABO-26 separately owns gated Batch retirement.

### Explicit model roster

`GEN_ALLOWED_MODELS_OPENAI` serves explicit selection and the independent default-off Batch and
speech-planner access guards. It never appends execution targets. Ordinary generation has no legacy
strict-no-paid allowlist gate. Authenticated operator controls and provider budgets remain intact.

### Inworld voice ranking

The enabled semantic ranker selects `openai` / `gpt-5.6-luna`, using one strict Responses request,
low reasoning/verbosity, `store: false` and a 1200-token cap. It retains the supplied speaker
shortlists, role/persona/accent guidance, one selection per speaker, and membership validation.
Duplicate ranked voices with alternatives reject the ranking; the existing catalog selects
voices deterministically, preserving explicit mappings and allowing reuse only when exhausted.
`ESL_TTS_VOICE_RANKER_*` controls remain independent; OpenAI TPM/daily-token limits also apply.
Failure uses existing deterministic catalog selection, never a different LLM target.
See the [inventory and Decisions comparison](../operations/openai-llm-migration.md).

### Study-text speech planning

- The speech planner remains default-off with exact `openai` / `gpt-5.6-luna`. Its independent
  enablement and same-target retries remain unchanged. `OPENAI_API_KEY` is its sole LLM credential;
  it sends `store: false`. Independent ElevenLabs, Deepgram, Inworld and Google Cloud STT/TTS
  integrations remain intact.
- The historical Gemini evaluation CLI is dry-run/offline-only. Its old model IDs, raw outputs,
  price snapshots and reports remain historical evidence, not active live targets. Live `--live`
  requests fail before provider construction. New provider evaluation requires separate authority.
- OpenAI account capacity, pricing and data-sharing eligibility are operator-verified inputs;
  no complimentary-token allowance is hardcoded. Keep local request/token guards and the
  organization's approved learner-data policy.
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
  `GEN_OPENAI_RETRY_*`. Its single-candidate use of the shared provider-runtime
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

## ESL-41 rollout and rollback

Use the [combined rollout/rollback checklist](../operations/openai-llm-migration.md) for ESL-38,
ESL-39, ESL-40 and ESL-41. Deployment, credential removal, historical-data mutation and paid calls
require separate authorization. Quiesce and inspect frozen pending targets before rollout; do not
rewrite them. Restore images and their matching environment together on rollback.

The read-only ABO-9 inventory on 2026-10-02 found historical Google Gemini 3 Flash selections for
lesson memory (341), homework memory (399) and snapshots (723), alongside OpenAI records. These are
retained record counts, not current traffic. Historical provider/provenance values are unchanged.
The ESL-41 inventory on 2026-10-10 found all configured memory/profile/assignment targets on OpenAI,
with only enabled voice ranking still configured on Gemma. See the checklist for exact settings.

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
- [`docs/reference/env.md`](env.md)
