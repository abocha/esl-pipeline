# Generation Provider Policy (WS2B)

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 8 minutes.
- Authority Level: canonical WS2B provider/model/quota policy.
- Last Updated: 2026-02-17.

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

### OpenRouter

1. Tertiary provider only for WS2B.
2. No free-tier assumptions are locked in this doc.
3. Activate only with explicit provider/model entry in config plus budget guardrail.

## Runtime Policy Requirements

1. Retry, timeout, and budget must be configured per provider.
2. Error handling classes must be normalized across providers:
   - `provider_rate_limit`
   - `provider_timeout`
   - `provider_contract_error`
3. Fallback behavior:
   - rate-limit/quota: attempt next model/provider ladder step.
   - timeout: retry then fallback.
   - contract/schema failure: fail fast with actionable error (no blind fallback).

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
- `docs/reference/env.md`
- `docs/backend-frontend/backend-frontend-alignment.md`
