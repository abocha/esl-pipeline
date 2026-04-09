# Google GenAI WS2B Implementation Profile

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 9 minutes.
- Authority Level: implementation-driving reference for WS2B Google GenAI integration.
- Last Updated: 2026-04-09.

## Purpose

- Define the exact subset of `@google/genai` used in WS2B.
- Lock request/response/error behavior before backend/frontend code changes.
- Keep Google provider integration deterministic and aligned with WS2B fallback policy.

## Scope

1. In scope:
   - text draft generation via `models.generateContent`,
   - optional streamed text generation via `models.generateContentStream`,
   - usage metadata extraction for quota telemetry.
2. Out of scope (deferred unless promoted in tracker):
   - broad multimodal workflows for WS2B MVP,
   - function/tool orchestration paths,
   - full SDK surface coverage.

## Normative Sources

1. Context7 library: `/googleapis/js-genai`
2. Supporting pages:
   - https://ai.google.dev/gemini-api/docs/text-generation
   - https://github.com/googleapis/js-genai/blob/main/README.md
   - https://github.com/googleapis/js-genai/blob/main/docs/classes/models.Models.html
   - https://github.com/googleapis/js-genai/blob/main/docs/classes/types.GenerateContentResponseUsageMetadata.html
   - https://github.com/googleapis/js-genai/blob/main/api-report/genai.api.md
   - https://github.com/googleapis/js-genai/blob/main/api-report/genai-node.api.md
3. Fallback source of truth for raw API schema:
   - https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta

## WS2B Method Surface (Used Now)

Allowed in WS2B:

1. `ai.models.generateContent(...)` (required)
2. `ai.models.generateContentStream(...)` (optional; only when streaming mode is enabled)
3. `ai.models.countTokens(...)` (optional preflight for guardrails/telemetry)

Explicitly not part of WS2B MVP implementation:

1. broad tool/function orchestration paths,
2. unrelated SDK resources outside generation path.

## Request Profile (WS2B)

Endpoint semantics are expressed through SDK calls:

1. required: `model`, `contents`
2. allowed WS2B fields:
   - `config.maxOutputTokens?`
   - provider-safe generation config fields explicitly approved in contracts
3. default behavior:
   - WS2B-S2 baseline is non-streaming (`generateContent`)
   - streaming is optional and must be explicitly enabled

Model policy alignment:

1. Provider/model selection and fallback order are controlled by:
   - `docs/reference/GENERATION_PROVIDER_POLICY.md`
2. This profile controls payload semantics, not provider priority decisions.

## Response Profile (Consumed Fields)

WS2B code must consume and normalize these fields:

1. generated text:
   - prefer `response.text` convenience field
2. identity/diagnostics when present:
   - `response.responseId`
   - `response.modelVersion`
3. usage metadata (`response.usageMetadata`):
   - `promptTokenCount`
   - `candidatesTokenCount`
   - `totalTokenCount`
   - `cachedContentTokenCount` (when present)
   - `toolUsePromptTokenCount` (when present)
   - `thoughtsTokenCount` (when present)

Note:

1. `usageMetadata` subfields are model/feature dependent; normalization must tolerate absent optional counters.

## Error Mapping Contract (Google -> Internal)

Internal categories are fixed by WS2B policy:

1. `provider_rate_limit`
2. `provider_timeout`
3. `provider_contract_error`

Mapping rules:

1. Rate limit:
   - condition: `error.status === 429`
   - map to: `provider_rate_limit`
2. Timeout/transient service failure:
   - condition: timeout/abort/network transient or status `408`, `504`, `>=500`
   - map to: `provider_timeout`
3. Contract/content validation failure:
   - condition: status `400`, `401`, `403`, `404`, `422`, malformed payload, or any remaining non-rate-limit provider error
   - map to: `provider_contract_error`

Fallback policy alignment:

1. `provider_rate_limit`: fallback down model/provider ladder.
2. `provider_timeout`: retry then fallback.
3. `provider_contract_error`: fail fast with actionable diagnostics (no blind fallback).

## Streaming Rules

1. If streaming is enabled, consume chunks from `generateContentStream`.
2. Chunk text must be read via `chunk.text` and assembled deterministically.
3. If a stream fails mid-flight, handle as timeout/transport unless provider returns a classified status payload.

## Transport and Retry Notes

From SDK/HTTP options surface:

1. timeout and retry behavior can be configured through HTTP options (`timeout`, retry attempts).
2. WS2B runtime policy still controls final retry/fallback behavior; SDK retry knobs must not conflict with provider policy.

## Contracts and File Mapping

1. Contracts:
   - `packages/contracts/src/index.ts`
   - Must include provider/model/error/usage fields needed by this profile.
2. Backend route/service:
   - `packages/batch-backend/src/transport/extended-routes.ts`
   - generation service path must normalize Google response and errors to contract DTOs.
3. Frontend consumption:
   - `packages/batch-frontend/src/utils/api.ts`
   - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
   - Must consume normalized DTOs only (not raw provider payload shape).

## Required Test Scenarios

1. Success path:
   - `generateContent` returns text and usage metadata mapped to quota snapshot DTO.
2. Rate limit mapping:
   - `429` maps to `provider_rate_limit`.
3. Timeout mapping:
   - timeout/transient status maps to `provider_timeout`.
4. Contract error mapping:
   - `400/401/403/404/422` and malformed payload map to `provider_contract_error`.
5. Optional streaming:
   - `generateContentStream` chunk assembly remains deterministic.

## Change Control

When `@google/genai` surface changes:

1. update this profile first,
2. then update contracts,
3. then backend/frontend code,
4. then tests and tracker evidence lines.

Do not implement fields or methods not declared in this profile unless tracker scope is explicitly expanded.

## Related

- `docs/reference/GENERATION_PROVIDER_POLICY.md`
- `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`
- `docs/reference/OPENROUTER_WS2B_PROFILE.md`
- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/reference/PRESET_V2_SPEC.md`
- `docs/reference/env.md`
