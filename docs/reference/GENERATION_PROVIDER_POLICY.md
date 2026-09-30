# Generation Provider Policy (WS2B)

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 5 minutes.
- Authority Level: canonical provider/model/quota policy.
- Last Verified Against: 2026-09-14 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after provider policy/availability changes.
- Status: `reference`.

## Purpose

- Lock provider/model defaults for direct draft generation.
- Keep quota and fallback policy stable during implementation.

## Locked Provider Order

1. `openai`
2. `google_ai_studio`
3. `openrouter`

## Locked Model Ladders

### OpenAI

- Built-in workload policy:
  - assignment creation: `gpt-6.1-sol` with `medium` reasoning and `medium` text verbosity
  - lesson memory and homework memory: `gpt-5.6-luna` with `medium` reasoning and `low` text verbosity
  - student-memory snapshot: `gpt-5.6-luna` with `high` reasoning and `low` text verbosity
  - profile revision and the closed `apply`/`no_change` candidate-patch decision: `gpt-5.6-luna`
    with `medium` reasoning and `low` text verbosity
- `GEN_OPENAI_TARGET_MODELS_ENABLED` remains a compatibility and operator-observability signal. Both
  flag states resolve to the same built-in workload policy; explicit `GEN_OPENAI_MODEL_*` overrides
  remain authoritative. The flag is not a paywall or user-plan control.
- direct draft generation:
  - primary: `gpt-6.1-sol` (`GEN_OPENAI_MODEL_ASSIGNMENT_DRAFT_PRIMARY`)
  - fallback: `gpt-5.6-luna`
- student-memory extraction:
  - primary: `gpt-5.6-luna`
  - fallback: `gpt-5.6-luna`
- profile revision drafting:
  - primary: `gpt-5.6-luna`
  - fallback: `gpt-5.6-luna`
  - tertiary fallback: `gpt-5.6-luna`

The prompt baseline follows the current
[OpenAI model guide](https://developers.openai.com/api/docs/guides/latest-model): preserve explicit
outcomes, constraints, evidence rules, success criteria, and output contracts; change working
prompts only for a measured failure or concrete contradiction.

The generic `GEN_OPENAI_MODEL_PRIMARY` remains `gpt-5.6-sol`; it does not control assignment
drafts. The implicitly allowlisted assignment primary is excluded from incidental fallback candidates
for unrelated workloads; explicit operator allowlists are preserved. Assignment model metadata in
`/config/job-options` uses the draft ladder. Explicit model
and provider overrides, fallback behavior, and strict allowlist enforcement remain available. An
explicit `GEN_ALLOWED_MODELS_OPENAI` override must include `gpt-6.1-sol` to permit that selection.

ABO-6 changes the shipped homework model/prompt contract. Production still requires explicit
prompt-assets bootstrap followed by admin activation; deployment alone does not activate the new
prompt.

### Google AI Studio

- primary: `gemini-3-flash-preview`
- fallback: `gemini-2.5-flash-lite`
- tertiary fallback: `gemini-2.5-pro`
- deprecated/removed from roster:
  - `gemini-3-pro-preview` (deprecated and shut down on March 9, 2026)
- current allowlisted roster for text generation:
  - `gemini-3.1-pro-preview`
  - `gemini-3-flash-preview`
  - `gemini-3.5-flash`
  - `gemini-3.1-flash-lite`
  - `gemini-3.5-flash-lite`
  - `gemini-2.5-pro`
  - `gemini-2.5-flash`
  - `gemini-2.5-flash-lite`
  - `gemma-4-31b-it`
  - `gemma-4-26b-a4b-it`
- `gemini-3.5-flash` is selectable as the stable 3.5 Flash model, but
  `gemini-3-flash-preview` remains the configured primary/default until a separate default-change
  decision lands.
- No model-specific quota baseline is set for `gemini-3.5-flash`; generic Google provider budgets
  still apply, and provider dashboard limits remain the external truth.
- Historical speech-planner evaluation keeps the exact stable Gemini model matrix immutable.
  Gemini 3.5 Flash-Lite uses default/minimal thinking for that baseline and receives
  no deprecated `temperature`, `top_p`, or `top_k` fields or prefilled model turn.
- The speech-planner evaluation price snapshot captured from the official Gemini pricing page on
  2026-07-28 records standard-text input/output rates per one million tokens as USD 0.25/1.50 for
  Gemini 3.1 Flash-Lite and USD 0.30/2.50 for Gemini 3.5 Flash-Lite. Output pricing includes
  thinking tokens; every run records its versioned snapshot rather than assuming these values are
  current indefinitely.

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

### OpenRouter

- tertiary path only
- exact production model remains an explicit activation decision

## Quota UX Mode

- `hybrid`
  - configured limits from backend
  - local usage counters from app telemetry
  - provider dashboard remains operator truth

## Runtime Rules

1. Retry, timeout, and budgets are configured per provider.
2. Default provider request timeout is 240000 ms (4 minutes) for direct generation paths.
3. Errors must normalize to:
   - `provider_rate_limit`
   - `provider_timeout`
   - `provider_contract_error`
   - `budget_exceeded`
4. Fallback behavior:
   - rate limit / quota -> fallback for fallback-capable generation workloads
   - timeout -> retry then fallback
   - contract/schema failure -> fail fast
   - local safety budget failure -> hard stop
   - canonical lesson-memory, homework-memory, and student-memory-snapshot extraction are the
     deliberate exception: a minute RPM/TPM rejection or provider HTTP 429 defers the original
     BullMQ job with its selected provider/model unchanged. It does not sleep a worker, enqueue a
     duplicate, or fall back to another provider. Daily limits, hard stops, capability/schema and
     business-validation failures, timeouts, 5xx responses, and non-429 provider failures retain
     their ordinary failure behavior.

## Active Safety Defaults

## Disabled OpenAI Batch Replay

- Historical lesson-memory, homework-memory, and snapshot replay may use the OpenAI Batch API only
  through the explicit `student-memory:batch` operator tool. It is not a fresh-work, fallback, or
  automatic queue path.
- `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false` is the separate default-off gate. It must not be
  replaced with or inferred from `GEN_ALLOW_PAID_SPEND` or `GEN_OPENAI_TARGET_MODELS_ENABLED`.
- `dry-run` is local and non-persistent. Every remote action requires the Batch gate, an OpenAI key,
  an allowlisted model, and explicit `--apply` for submit, retry, or cancellation.
- This policy does not authorize provider calls, activation, or deployment. Those remain separate
  maintainer decisions after code review.

- `GEN_SAFETY_MODE=hard_stop`
- `GEN_STRICT_NO_PAID=true`
- `GEN_MAX_OUTPUT_TOKENS_HARD=12000`
- `GEN_ALLOW_PAID_SPEND=false`

Additional rules:

- allowlists are enforced before provider calls in strict mode
- `0` budgets are intentional hard blocks
- quota windows are evaluated in UTC and must unblock correctly after rollover
- OpenRouter remains effectively disabled until explicitly budgeted/enabled

## Implementation Expectations

- `/config/job-options` exposes provider/model/quota metadata
- `POST /generation/drafts` may accept provider/model overrides
- responses must retain provider/model/quota context for auditability
- preset semantics and provider semantics must stay decoupled
- student-memory extraction capability is governed separately by
  [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
- Evaluators are optional diagnostic/evaluation tooling, not merge or activation gates.
  Offline fixtures can be inspected with:
  `pnpm --filter @esl-pipeline/batch-backend generation:eval`
- Optional live evaluation requires explicit paid-provider authorization and the opt-in flag:
  `GENERATION_LIVE_EVAL_ENABLED=true pnpm --filter @esl-pipeline/batch-backend generation:eval:live`

## Detailed Provider References

- [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
- [`docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
- [`docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`](OPENAI_RESPONSES_WS2B_PROFILE.md)
- [`docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`](GOOGLE_GENAI_WS2B_PROFILE.md)
- [`docs/reference/OPENROUTER_WS2B_PROFILE.md`](OPENROUTER_WS2B_PROFILE.md)
- [`docs/reference/env.md`](env.md)
