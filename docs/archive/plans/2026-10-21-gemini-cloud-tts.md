# Gemini Cloud TTS integration (ESL-67)

- Status: `archived`.
- Last Verified Against: 2026-10-21 source and Google Cloud documentation.
- Exit Trigger: implementation evidence captured; durable guidance is in owning READMEs.
- Current Focus: hosted CI and maintainer listening; production rollout remains separate.
- Execution: [ESL-67](https://linear.app/abocha/issue/ESL-67).

## Decision and authority

The maintainer authorized design, implementation, review and validation in the current chat,
including ordinary product decisions. Twelve synthetic listening clips established a preference
for Gemini over Inworld; Flash-Lite tied Flash on narration, was preferred for longer dialogue,
and was close on pronunciation. Evidence and verbatim feedback live in
[`scripts/tts-listening-trial`](../../../scripts/tts-listening-trial/README.md).

Use plan-backed execution. Existing SSOT, evidence route and mutation boundaries apply. No durable
runtime Goal is needed. In a follow-up before merge, the maintainer requested Gemini as the
no-env code default, env-controlled fresh authoring, and retention of Chirp for short chunks.
No production configuration edit, deployment or merge is authorized here.

## Simplest adequate design

- Add provider `gemini`; preserve `google` as Cloud Text-to-Speech/Chirp. Reusing that durable ID
  would change saved job meaning. Additive provider/model unions and database checks are necessary
  enablers, not a historical-data migration.
- Default fresh study text to Gemini `gemini-3.8-flash-lite-tts`; allow `gemini-3.8-flash-tts` and
  env provider/model overrides. Preserve explicit saved selections. No content-based model router.
- Google Cloud global `aiplatform.googleapis.com` unary `generateContent`, using ADC and an explicit
  namespaced project ID. Reuse installed `google-auth-library`, standard fetch and existing media
  tools rather than adding a second generative SDK or shelling out to gcloud at runtime.
- Deterministic prebuilt voices and plain authored text. Keep canonical voice-plan and speech-plan
  stages: deterministic assignment and identity speech plans avoid external ranker/planner calls.
  One native request for monologue or exactly two-speaker dialogue. Reject unsupported speaker
  counts and incomplete model output clearly; no hidden provider fallback.
- Convert complete WAV to the existing MP3 artifact contract. Cache identity includes provider,
  model, project, voices, source/strategy and policy; honor force/cancellation. Preserve durable
  rerun family ownership and persisted provider/model attribution.
- Include canonical study-text, shadow sentence and pronunciation text flows. Full pronunciation
  sentences follow the study-text provider/model; short item clips default to Google Chirp 3 HD.
  Explicit per-family rerun overrides remain available.
- Keep normal HTTP timeout/error classification bounded and secret-safe. Emit actual usage tokens
  by modality; do not mislabel token pricing as per-character pricing.

No streaming, Batch/Flex, custom voice creation, expanded voice-ranking machinery, universal pause
instructions, unrelated provider cleanup or learner-data uploads. Reconsider delivery tuning only
for a reproduced quality problem in the integrated path.

## Acceptance and evidence

1. Provider/model choices round-trip through operator settings, jobs, queue and persisted checks;
   existing providers and frozen historical values retain meaning.
2. Validated synthetic AssignmentV1 produces playable study-text and pronunciation audio through
   orchestrator, learner rendering and manifest with Gemini attribution. No planner/ranker calls.
3. Identical synthesis reuses local cache; model/voice/text changes cannot reuse incompatible audio.
   Selected-family reruns and force semantics retain their existing ownership contract.
4. Focused credential-free tests cover request/response/error/cancellation and affected admission,
   persistence and rerun boundaries. Relevant builds/typechecks/docs checks pass. Review follows
   actual residual risk, especially credentials, cache identity and durable provider checks.
5. Small live-provider synthetic evidence uses isolated local publication, never normal production
   storage. Dry-run alone is insufficient because it previews TTS; upload omission alone is
   insufficient because normal HTML publication still reaches S3.
6. Record local, provider, manual listening, hosted CI and billing evidence separately. Credits
   expire 2027-01-19; specific SKU credit application remains pending billing posting. Prepared
   integrated audio is made available for maintainer listening.

## Primary external evidence

- [Cloud Gemini TTS guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/text-to-speech/overview)
  documents plain-text turns, exactly two speakers, complete unary WAV and global Cloud endpoint.
- [Flash-Lite model](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash-lite-tts)
  lists Preview, 8,192 input / 16,384 output tokens. Do not publish truncated generations.

Completion closes these criteria and repository-required gates. Deployment and production default
selection remain separate operator actions; no extra compatibility campaign after the named
invariants are closed.

## Implementation evidence

- Added the `gemini` adapter, additive contracts/selection/queue/event/UI support and migration
  `0073_gemini_tts_provider`. Existing provider IDs and rows are preserved. Follow-up code defaults
  use Gemini while fresh authoring honors env metadata; item clips retain the Chirp split.
- Migration is runtime-incompatible for old workers because they cannot parse new provider rows;
  application and schema rollout must be coordinated. The backend README owns that guidance.
- Provider build/typecheck and 15 focused tests passed, including authored form versus conflicting
  legacy strategy flags. Focused exceptional-risk review found no unresolved material findings
  after provider-only pronunciation reruns and configured-default propagation were corrected.
- Backend/frontend typechecks, 42 selected backend tests, 20 frontend tests, actual PostgreSQL
  upgrade/constraint test and generated-baseline verification passed on disposable PostgreSQL 18.6.
- Real Cloud ADC synthesis produced a local canonical handout with study text, shadow sentence and
  word clips: five synthesis calls, then zero additional calls on an identical cached pipeline run.
  A final configured-default/monologue run and browser checks are recorded in local smoke evidence.
- Hosted CI and final maintainer listening are distinct from this local evidence. No production
  application settings, queue/data or environment values were changed; no deployment or merge ran.
