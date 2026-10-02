# OpenAI Responses WS2B Implementation Profile

## Meta

- Audience: founder-maintainer and implementing agents.
- Read Time: 10 minutes.
- Authority Level: implementation-driving reference for WS2B OpenAI integration.
- Last Updated: 2026-07-11.

## Purpose

- Define the exact subset of the OpenAI Responses API used in WS2B.
- Prevent accidental scope creep from the full API surface.
- Lock request/response/error behavior before backend/frontend code changes.

## Scope

1. In scope:
   - draft generation via OpenAI Responses API,
   - deterministic error mapping to internal categories,
   - usage extraction for quota telemetry and UI.
2. Out of scope (deferred unless promoted in tracker):
   - generalized tool-calling,
   - multimodal workflows beyond current prompt package needs,
   - full Responses resource coverage.

## Normative Sources

1. Official OpenAI docs (primary authority):
   - https://developers.openai.com/api/reference/typescript/resources/responses
   - https://platform.openai.com/docs/api-reference/responses/compact
   - https://platform.openai.com/docs/api-reference/responses/input-items
2. Local snapshot (secondary evidence only):
   - `tmp/respornses.md` (maintainer-exported TypeScript reference snapshot).

## WS2B Method Surface (Baseline)

Allowed in WS2B:

1. `client.responses.create(...)` (required)

Explicitly not part of WS2B MVP implementation:

1. `client.responses.delete(...)`
2. `client.responses.inputItems.list(...)`
3. broad tool orchestration and non-essential resource methods
4. `retrieve`/`cancel` flows in baseline S1/S2 (defer unless async/background flow is introduced)

## Request Profile (WS2B)

### Disabled Student-Memory Batch Extension

The operator-only student-memory replay lane serializes the same `/v1/responses` request body into
OpenAI Batch JSONL. It is limited to one workload/model slice, uses `/v1/responses` with a `24h`
completion window, and remains disabled by `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false`. Its output
is parsed and validated by the same structured-output/evidence contract as online generation. Batch
files are read in memory only; durable state retains request snapshots, canonical content, and safe
diagnostics, never raw output files.

Endpoint and required fields:

1. `POST /v1/responses` via `client.responses.create(...)`
2. required: `model: string`, `input: string | ResponseInput`

Allowed WS2B fields:

1. `instructions?: string`
2. `max_output_tokens?: number`
3. `metadata?: Record<string, string>` (lineage/tracing)
4. `stream?: boolean`
5. `reasoning.effort` and `text.verbosity`, only from the versioned workload request envelope
6. `text.format` with strict `json_schema` for AssignmentV1, structured extraction and closed candidate-patch output

Deferred optional fields (not baseline WS2B-S1/S2):

1. `prompt_cache_key?: string`
2. `safety_identifier?: string`

WS2B defaults and limits:

1. WS2B-S2 baseline is non-streaming (`stream=false`).
2. `background` defaults to `false` unless async flow is explicitly introduced.
3. Do not add ad-hoc `tools`/`tool_choice` or unrelated reasoning knobs in MVP.

## Request Envelope and Trust Boundary

Generation uses `generation_request_envelope_v1`. Trusted policy is sent through Responses
`instructions`; transcripts, teacher notes, memory, and profile data are sent separately as labelled
`input` source-data blocks. Each envelope states that source data is evidence rather than executable
instructions, records the selected source manifest and a source-selection hash, and carries the
workload's reasoning/verbosity policy and optional strict schema. Non-OpenAI providers receive the
same deterministic flattened representation.

The shipped OpenAI workload mapping is assignment draft on `gpt-6.1-sol` at medium reasoning and
medium verbosity; lesson memory, homework memory, profile revision, and profile candidate patch
on `gpt-5.6-luna` at medium reasoning and low verbosity; and student-memory snapshot on
`gpt-5.6-luna` at high reasoning and low verbosity. Speech performance plans use high reasoning
and low verbosity, with model selection governed by the separate speech-planning policy.
These single-turn structured workflows do not
enable Pro mode, persisted reasoning, tools, explicit caching, Programmatic Tool Calling, or
multi-agent execution.

Consequential structured claims must reference a source ID in the request manifest and include a
short evidence excerpt. Candidate promotion is a closed `apply`/`no_change` decision over selected
approved candidate IDs; backend code applies approved facts and preserves unrelated profile fields.

AssignmentV1 additionally admits only a completed non-refusal assistant message and direct JSON.
It preserves usage before local domain rejection and deterministically returns PMD through the
existing text DTO; see [AssignmentV1](ASSIGNMENT_V1.md). Other structured workloads retain
their current online/Batch parsing contracts.

## Response Profile (Consumed Fields)

WS2B code must consume and normalize these fields:

1. `id`
2. `status`
3. `model`
4. `error` (if present)
5. `incomplete_details` (if present)
6. generated text:
   - prefer `response.output_text` convenience where available,
   - otherwise parse from `output[*].content[*].text` deterministically.
7. `usage`:
   - `input_tokens`
   - `output_tokens`
   - `total_tokens`
   - `input_tokens_details.cached_tokens` (when present)
   - `output_tokens_details.reasoning_tokens` (when present)

## Error Mapping Contract (OpenAI -> Internal)

Internal categories are fixed by WS2B policy:

1. `provider_rate_limit`
2. `provider_timeout`
3. `provider_contract_error`

Mapping rules:

1. OpenAI rate limit:
   - condition: `error.code == "rate_limit_exceeded"` or HTTP `429`
   - map to: `provider_rate_limit`
2. Timeout/transient service failure:
   - condition: network timeout/abort (`ETIMEDOUT`, `AbortError`, `ECONNRESET`), HTTP `408`, `504`, `>=500`, or `error.code == "server_error"`
   - map to: `provider_timeout`
3. Contract/content validation failure:
   - condition: HTTP `400`, `401`, `403`, `404`, `422`, `error.code == "invalid_prompt"`, malformed response payload, or any remaining non-rate-limit OpenAI error code
   - map to: `provider_contract_error`

Fallback policy alignment:

1. `provider_rate_limit`: fallback down model/provider ladder.
2. `provider_timeout`: retry then fallback.
3. `provider_contract_error`: fail fast with actionable diagnostics (no blind fallback).

## Streaming and Background Rules

1. If streaming is enabled later, handle at minimum:
   - `response.output_text.delta`
   - `response.output_text.done`
2. Stream resume may use `starting_after` via retrieve/stream flows.
3. `cancel` is valid only for background responses (`background=true`).

## Contracts and File Mapping

1. Contracts (authoritative DTO surface):
   - `packages/contracts/src/index.ts`
   - Must include generation request/response payloads aligned to this profile.
2. Backend route/service:
   - `packages/batch-backend/src/transport/extended-routes.ts`
   - `packages/batch-backend/...` generation service path
   - Must implement request shaping, OpenAI invocation, and error/usage normalization.
3. Frontend consumption:
   - `packages/batch-frontend/src/utils/api.ts`
   - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
   - Must consume normalized generation response and usage/quota metadata only (not raw provider payloads).

## Required Test Scenarios

1. Success path:
   - create returns usable text + usage fields.
2. Rate limit mapping:
   - simulated `rate_limit_exceeded` maps to `provider_rate_limit`.
3. Timeout mapping:
   - timeout/network/server transient maps to `provider_timeout`.
4. Contract error mapping:
   - `400/401/403/404/422`, `invalid_prompt`, and malformed payload map to `provider_contract_error`.
5. Usage accounting:
   - token fields propagate to quota snapshot DTO.
6. Optional streaming (if enabled):
   - delta + done event handling is deterministic.

## Change Control

When OpenAI SDK/doc surface changes:

1. update this profile first,
2. then update contracts,
3. then backend/frontend code,
4. then tests and tracker evidence lines.

Do not implement fields or methods not declared in this profile unless the tracker explicitly extends WS2B scope.

## Related

- `docs/reference/GENERATION_PROVIDER_POLICY.md`
- `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`
- `docs/reference/OPENROUTER_WS2B_PROFILE.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
- `docs/reference/PRESET_V2_SPEC.md`
- `docs/reference/env.md`
