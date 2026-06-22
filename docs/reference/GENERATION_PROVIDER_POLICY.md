# Generation Provider Policy (WS2B)

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 5 minutes.
- Authority Level: canonical provider/model/quota policy.
- Last Verified Against: 2026-06-21 repo state.
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

- Current production-default activation remains unchanged until a credentialed live evaluation report
  is reviewed. `GEN_OPENAI_TARGET_MODELS_ENABLED` defaults to `false` and is the explicit operator
  gate; it is not a paywall or user-plan control.
- Evaluated target ladder (only after that gate is deliberately enabled):
  - assignment creation: `gpt-5.5`
  - lesson/homework/snapshot memory and profile drafts: `gpt-5.4-mini`
  - memory fallback and the closed `apply`/`no_change` candidate-patch decision: `gpt-5.4-nano`
- direct draft generation:
  - primary: `gpt-5.4-mini`
  - fallback: `gpt-5.4-nano`
- student-memory extraction:
  - primary: `gpt-5.4-nano`
  - fallback: `gpt-5.4-mini`
- profile revision drafting:
  - primary: `gpt-5.4`
  - fallback: `gpt-5.4-mini`
  - tertiary fallback: `gpt-5.4-nano`

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
  - `gemini-3.1-flash-lite-preview`
  - `gemini-2.5-pro`
  - `gemini-2.5-flash`
  - `gemini-2.5-flash-lite`
- `gemini-3.5-flash` is selectable as the stable 3.5 Flash model, but
  `gemini-3-flash-preview` remains the configured primary/default until a separate default-change
  decision lands.
- No model-specific quota baseline is set for `gemini-3.5-flash`; generic Google provider budgets
  still apply, and provider dashboard limits remain the external truth.

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
- `GEN_MAX_OUTPUT_TOKENS_HARD=3200`
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
- generation changes require the versioned offline fixture command before merging:
  `pnpm --filter @esl-pipeline/batch-backend generation:eval`
- target-default activation additionally requires a successful, retained report from
  `GENERATION_LIVE_EVAL_ENABLED=true pnpm --filter @esl-pipeline/batch-backend generation:eval:live`

## Detailed Provider References

- [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
- [`docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
- [`docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`](OPENAI_RESPONSES_WS2B_PROFILE.md)
- [`docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`](GOOGLE_GENAI_WS2B_PROFILE.md)
- [`docs/reference/OPENROUTER_WS2B_PROFILE.md`](OPENROUTER_WS2B_PROFILE.md)
- [`docs/reference/env.md`](env.md)
