# OpenRouter WS2B Implementation Profile

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 9 minutes.
- Authority Level: implementation-driving reference for WS2B OpenRouter integration.
- Last Updated: 2026-02-18.

## Purpose

- Define the exact OpenRouter API subset used for WS2B.
- Lock request/response/error behavior before backend/frontend code changes.
- Keep OpenRouter integration deterministic and aligned with WS2B provider policy.

## Scope

1. In scope:
   - text draft generation via `POST /api/v1/chat/completions`,
   - model catalog reads via `GET /api/v1/models`,
   - optional generation cost/latency metadata lookup via `GET /api/v1/generation?id=...`.
2. Out of scope (deferred unless promoted in tracker):
   - broad multimodal or tool orchestration paths,
   - full OpenRouter API surface,
   - consumer-facing billing policy.

## Normative Sources

1. Context7 library: `/websites/openrouter_ai`
2. Supporting pages:
   - https://openrouter.ai/docs/api-reference/overview
   - https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
   - https://openrouter.ai/docs/api/api-reference/models/get-models
   - https://openrouter.ai/docs/api-reference/get-a-generation

## WS2B Method Surface (Used Now)

Allowed in WS2B:

1. `POST /api/v1/chat/completions` (required)
2. `GET /api/v1/models` (required for model option metadata)
3. `GET /api/v1/generation?id=...` (optional for post-run cost/latency enrichment)

Explicitly not part of WS2B MVP implementation:

1. generalized `/responses` API path integration,
2. broad plugin/tool workflows,
3. unsupported parameter passthrough without contract updates.

## Request Profile (WS2B)

Endpoint:

1. `POST https://openrouter.ai/api/v1/chat/completions`

Headers:

1. Required:
   - `Authorization: Bearer <OPENROUTER_API_KEY>`
   - `Content-Type: application/json`
2. Optional but recommended:
   - `HTTP-Referer`
   - `X-Title`

Required body fields in WS2B:

1. `model` (string)
2. `messages` (array)

Note:

1. OpenRouter API may permit model-routing variants without explicit `model`, but WS2B policy requires explicit model selection for deterministic auditability.

Allowed WS2B fields:

1. `stream` (default `false` in WS2B baseline)
2. `max_tokens`
3. `temperature`
4. `top_p`
5. `response_format`
6. `seed`
7. OpenRouter routing fields:
   - `models` (fallback model array)
   - `route` (`fallback` when enabled)
   - `provider` (provider preferences when needed)
8. `metadata`

WS2B defaults:

1. non-streaming by default,
2. explicit `model` must always be set (no implicit auto in WS2B),
3. fallback behavior follows provider policy ladder.

## Response Profile (Consumed Fields)

WS2B code must consume and normalize these fields from chat completion response:

1. `id`
2. `model`
3. `choices[0].message.content` (or equivalent first textual assistant output)
4. `choices[0].finish_reason` (when present)
5. `usage.prompt_tokens`
6. `usage.completion_tokens`
7. `usage.total_tokens`
8. `usage.cost` (when present)
9. `usage.prompt_tokens_details.cached_tokens` and `usage.completion_tokens_details.reasoning_tokens` (when present)

Optional enrichment via `GET /api/v1/generation?id=...`:

1. `data.total_cost`
2. `data.provider_name`
3. `data.latency`
4. `data.tokens_prompt`
5. `data.tokens_completion`
6. `data.native_tokens_reasoning` / `data.native_tokens_cached` (if available)

Model catalog mapping for `GET /api/v1/models` (job-options payload):

1. `data[*].id`
2. `data[*].name`
3. `data[*].context_length`
4. `data[*].pricing.prompt`
5. `data[*].pricing.completion`
6. `data[*].supported_parameters` (when present)

## Error Mapping Contract (OpenRouter -> Internal)

Internal categories are fixed by WS2B policy:

1. `provider_rate_limit`
2. `provider_timeout`
3. `provider_contract_error`

Mapping rules:

1. Rate limit:
   - condition: HTTP `429`
   - map to: `provider_rate_limit`
2. Timeout/transient provider failure:
   - condition: timeout/abort/network transient or HTTP `408`, `500`, `502`, `503`, `504`
   - map to: `provider_timeout`
3. Contract/auth/budget/content validation failure:
   - condition: HTTP `400`, `401`, `402`, `404`, `413`, `422`, malformed payload, or any remaining non-rate-limit provider error
   - map to: `provider_contract_error`

Fallback policy alignment:

1. `provider_rate_limit`: fallback down model/provider ladder.
2. `provider_timeout`: retry then fallback.
3. `provider_contract_error`: fail fast with actionable diagnostics (no blind fallback).

## Streaming Rules

1. Streaming is optional and disabled by default in WS2B baseline.
2. If enabled later, chunk assembly must remain deterministic and compatible with UI draft flow.
3. Mid-stream transport failure is handled as timeout/transient unless classified otherwise.

## Contracts and File Mapping

1. Contracts:
   - `packages/contracts/src/index.ts`
   - Must include provider/model/error/usage fields needed by this profile.
2. Backend route/service:
   - `packages/batch-backend/src/transport/extended-routes.ts`
   - generation service path must normalize OpenRouter response and errors to contract DTOs.
3. Frontend consumption:
   - `packages/batch-frontend/src/utils/api.ts`
   - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
   - Must consume normalized DTOs only (not raw OpenRouter payload shapes).

## Required Test Scenarios

1. Success path:
   - chat completion returns text and usage token fields.
2. Fallback routing payload:
   - request can pass `models` fallback array and `route=fallback` when configured.
3. Rate limit mapping:
   - `429` maps to `provider_rate_limit`.
4. Timeout mapping:
   - transient `5xx`/transport timeout maps to `provider_timeout`.
5. Contract error mapping:
   - `400/401/402/404/413/422` and malformed payload map to `provider_contract_error`.
6. Optional generation enrichment:
   - `GET /generation` fields map to cost/latency telemetry DTO without breaking baseline flow.
7. Model catalog mapping:
   - `GET /models` fields map deterministically into `GenerationModelOption` entries for `/config/job-options`.

## Change Control

When OpenRouter API/docs change:

1. update this profile first,
2. then update contracts,
3. then backend/frontend code,
4. then tests and tracker evidence lines.

Do not implement fields or methods not declared in this profile unless tracker scope is explicitly expanded.

## Related

- `docs/reference/GENERATION_PROVIDER_POLICY.md`
- `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`
- `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`
- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/reference/PRESET_V2_SPEC.md`
- `docs/reference/env.md`
