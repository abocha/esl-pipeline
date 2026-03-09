# Generation Provider Policy (WS2B)

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 8 minutes.
- Authority Level: canonical WS2B provider/model/quota policy.
- Last Verified Against: 2026-03-10 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after provider policy/availability changes.
- Status: `reference`.

## Purpose

- Lock provider/model defaults for WS2B generation before code rollout.
- Define quota visibility and fallback behavior for MVP.
- Prevent re-decisions during WS2B-S1/S2/S3 implementation.

## Scope

1. Applies to direct draft generation in WS2B.
2. Applies to provider/model selection and quota visualization in minimal UI.
3. Does not define consumer-facing billing/pricing.

## Locked Decisions

### Provider Priority

1. `openai` (primary)
2. `google_ai_studio` (secondary)
3. `openrouter` (tertiary)

### Default Model Ladders

1. OpenAI:
   - primary: `gpt-5.2`
   - fallback: `gpt-5-mini`
2. Google AI Studio (free-tier-first in this phase):
   - primary: `gemini-3-flash-preview`
   - fallback: `gemini-2.5-flash-lite`
   - tertiary fallback: `gemini-2.5-pro`
3. OpenRouter:
   - tertiary path is supported by architecture.
   - concrete model lock is deferred until OpenRouter activation for WS2B traffic.

### Quota UX Mode (Locked)

- `hybrid`
  - show configured policy limits from backend,
  - show local usage counters from app telemetry,
  - show provider dashboard link as operator truth source.

## Provider Quota Baseline

### Quota Acronyms

1. `RPM` = requests per minute
2. `TPM` = tokens per minute
3. `RPD` = requests per day

### OpenAI (Complimentary Daily Tokens)

For enrolled orgs with data sharing enabled:

1. Up to `250,000` tokens/day across higher-tier model group.
2. Up to `2,500,000` tokens/day across mini/nano group.
3. Quota resets daily at `00:00 UTC`.
4. Applies to traffic shared with OpenAI; overages are billed normally.

Reference:

- https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai

### Google AI Studio (Dashboard-Authoritative, Free-Tier-First)

Dashboard values provided by maintainer account (as of 2026-02-17):

1. `gemini-3-flash-preview`
   - RPM: `5`
   - TPM: `250K`
   - RPD: `20`
2. `gemini-2.5-flash-lite`
   - RPM: `10`
   - TPM: `250K`
   - RPD: `20`
3. `gemini-2.5-pro`
   - RPM: `15`
   - TPM: `Unlimited`
   - RPD: `1.5K`

Policy notes:

1. Dashboard model IDs and limits are authoritative for runtime in this phase.
2. Public docs can lag preview naming and should be treated as reference, not override.
3. Google limits are project-scoped and can change; keep values date-stamped when updated.

References:

- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/pricing

### Operator Availability Note (2026-03-03, Free-Tier Key Probe)

Direct `generateContent` ping probe (`Reply with exactly PONG.`) observed:

1. `gemini-3.1-pro-preview` -> `429` (quota/billing)
2. `gemini-3-pro-preview` -> `429` (quota/billing)
3. `gemini-3-flash-preview` -> `503` under high demand (transient capacity)
4. `gemini-2.5-pro` -> `429` (quota/billing)
5. `gemini-flash-lite-latest` -> `200`
6. `gemini-2.5-flash` -> `200`
7. `gemini-2.5-flash-lite` -> `200`

Policy interpretation for local operations:

1. Keep `gemini-3-flash-preview` in the allowed set and fallback ladder.
2. Prefer flash-tier defaults for stability under free-tier constraints.
3. Re-run the same probe after API-key tier changes before concluding model regressions.

### Operator Availability Note (2026-03-03, Tier-1 Key Probe)

Direct `generateContent` ping probe (`Reply with exactly PONG.`) observed:

1. `gemini-3.1-pro-preview` -> timed out at client max-time (`70s`) in probe run (treat as demand/capacity-sensitive, not removed from docs support matrix).
2. `gemini-3-pro-preview` -> `200` (`PONG`).
3. `gemini-3-flash-preview` -> `200` (`PONG`).
4. `gemini-2.5-pro` -> `200` (one probe returned `MAX_TOKENS` with empty visible text; follow-up probes returned `PONG`).
5. `gemini-flash-lite-latest` -> `200` (`PONG`).
6. `gemini-2.5-flash` -> `200` (`PONG`).
7. `gemini-2.5-flash-lite` -> `200` (`PONG`).

Operator implications:

1. Tier-1 key materially improves model availability versus free-tier for `3-pro`, `3-flash`, and `2.5-pro`.
2. Keep `gemini-3-flash-preview` active in allowlist/fallback ladder.
3. For `gemini-2.5-pro`, avoid overly tight output caps in smoke probes, since high thought-token usage can produce `MAX_TOKENS` before visible output.

### OpenRouter

1. Tertiary provider only for WS2B.
2. No free-tier assumptions are locked in this doc.
3. Activate only with explicit provider/model entry in config plus budget guardrail.

Reference:

- https://openrouter.ai/docs/models

## Runtime Policy Requirements

1. Retry, timeout, and budget must be configured per provider.
2. Error handling classes must be normalized across providers:
   - `provider_rate_limit`
   - `provider_timeout`
   - `provider_contract_error`
   - `budget_exceeded`
3. Fallback behavior:
   - rate-limit/quota: attempt next model/provider ladder step.
   - timeout: retry then fallback.
   - contract/schema failure: fail fast with actionable error (no blind fallback).
   - local safety-budget failure (`budget_exceeded`): hard stop with explicit limit details.

### WS3.5 Safety Guardrails (Active)

1. Safety defaults are fail-safe for local battle-testing:
   - `GEN_SAFETY_MODE=hard_stop`
   - `GEN_STRICT_NO_PAID=true`
   - `GEN_MAX_OUTPUT_TOKENS_HARD=1200`
   - `GEN_ALLOW_PAID_SPEND=false`
2. Provider/model allowlists are enforced before provider calls when strict mode is enabled.
3. Budget counters are persisted by provider/model/time bucket and surfaced in quota metadata:
   - daily request usage/remaining
   - daily token usage/remaining
   - per-minute request usage/remaining
4. OpenRouter is blocked by default through zero-budget defaults unless explicitly enabled.
5. Intentional paid-mode override is available via `GEN_ALLOW_PAID_SPEND=true`
   (legacy alias: `GEN_BUDGET_EMERGENCY_OVERRIDE=true`).

### WS3.5 Operational Semantics

1. `budget_exceeded` is a local safety-policy result, not a raw provider-originated error.
2. Budget-block windows are evaluated in UTC:
   - `rpmRemaining <= 0` blocks only while still in the same UTC minute window.
   - `daily*Remaining <= 0` blocks only while still in the same UTC day window.
3. Explicit zero-budget configs are treated as hard-stop policy:
   - when budget is `0` and remaining is exhausted, generation stays blocked until config changes.
4. UI/runtime quota snapshots must not indefinitely block generation after window rollover.

### OpenAI API Reference Contract (WS2B)

OpenAI-specific request/response/error semantics for implementation are defined in:

- `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`

### Google API Reference Contract (WS2B)

Google-specific request/response/error semantics for implementation are defined in:

- `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`

### OpenRouter API Reference Contract (WS2B)

OpenRouter-specific request/response/error semantics for implementation are defined in:

- `docs/reference/OPENROUTER_WS2B_PROFILE.md`

This policy doc stays provider-strategy oriented; do not duplicate low-level provider payload
details here.

## WS2B Contract/Route Expectations

1. `/config/job-options` must expose generation metadata:
   - provider options,
   - model options,
   - default selection ladder,
   - quota view payload.
2. `POST /generation/drafts` must accept optional provider/model override.
3. Response must include provider/model used and quota snapshot for auditability.

## Implementation Notes

1. Learning preset remains pedagogic contract (`prompt + metadata + output schema`).
2. Provider/model remains runtime execution control selected before generation.
3. Keep preset logic and provider logic decoupled to avoid model-tier prompt forks.

## Related

- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/reference/PRESET_V2_SPEC.md`
- `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`
- `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`
- `docs/reference/OPENROUTER_WS2B_PROFILE.md`
- `docs/reference/env.md`
- `docs/backend-frontend/backend-frontend-alignment.md`
