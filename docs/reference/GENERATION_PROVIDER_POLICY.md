# Generation Provider Policy (WS2B)

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 5 minutes.
- Authority Level: canonical provider/model/quota policy.
- Last Verified Against: 2026-03-13 repo state.
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
  - `gemini-3.1-flash-lite-preview`
  - `gemini-2.5-pro`
  - `gemini-2.5-flash`
  - `gemini-2.5-flash-lite`

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
   - rate limit / quota -> fallback
   - timeout -> retry then fallback
   - contract/schema failure -> fail fast
   - local safety budget failure -> hard stop

## Active Safety Defaults

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

## Detailed Provider References

- [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
- [`docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
- [`docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`](OPENAI_RESPONSES_WS2B_PROFILE.md)
- [`docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`](GOOGLE_GENAI_WS2B_PROFILE.md)
- [`docs/reference/OPENROUTER_WS2B_PROFILE.md`](OPENROUTER_WS2B_PROFILE.md)
- [`docs/reference/env.md`](env.md)
