# ElevenLabs Mixed-Recording Production Adoption

## Meta

- Audience: maintainers implementing or reviewing the production STT cutover.
- Authority Level: implementation scope and acceptance contract.
- Last Verified Against: `89be936b2b0407369602dd7f531acc8175f80592` and the accepted 2026-08-30 production-path investigation.
- Owner: founder-maintainer + speech-runtime maintainers.
- Review Cadence: before implementation and after any material STT, transcript, or upload-contract change.
- Status: `draft`.
- Exit Trigger: archive after the implementation PR merges and active runtime/docs contracts are synchronized.
- Current Focus: adopt ElevenLabs Scribe v2 for ordinary mixed uploads without weakening trusted split-channel identity or downstream speaker attribution.

## Goal

An ordinary recording upload defaults to `mixed_recording`, is transcribed once by ElevenLabs Scribe v2 with the benchmark-winning mixed profile, retains anonymous speakers until the tutor maps their roles in the existing Source review step, and then continues through the current confirmed transcript, lesson-memory, prompt, homework, and persistence flow.

An explicitly declared trusted OBS split remains `trusted_split_channels` and uses the existing Deepgram Nova-3 multichannel/channel-role route. Manual transcripts remain unchanged.

The benchmark decision is closed. This plan does not compare providers or authorize further benchmarking.

## Current Contract Evidence

1. `processTranscribeJob` currently selects one provider from the queue payload/default, calls the provider, formats segments, writes transcript text and speaker-track metadata, and persists the transcript (`packages/batch-backend/src/application/process-transcribe-job.ts`).
2. `formatSpeakerLabel` currently assigns speaker `0` to `Teacher` and `1` to `Student` for every topology (`packages/stt-core/src/format.ts`). That is valid for trusted channel roles, not provider diarization.
3. The transcript is returned as editable text by `getRecordingTranscript`; `updateRecordingTranscript` saves a new working version; and `MinimalAssignment` saves dirty text before confirming the Source step (`packages/batch-backend/src/application/get-recording-transcript.ts`, `packages/batch-backend/src/application/update-recording-transcript.ts`, `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`).
4. Source confirmation freezes transcript URI/hash/version and starts lesson-memory generation. `createPromptPackage` later reads that confirmed transcript verbatim into homework prompt/context assembly (`packages/batch-backend/src/domain/assignment-session-repository.ts`, `packages/batch-backend/src/application/process-lesson-memory-job.ts`, `packages/batch-backend/src/application/create-prompt-package.ts`).
5. `extractStudentOnlyTranscript` recognizes literal `Student` turns; anonymous `Speaker N` turns are excluded. `resolveStudentTrackTranscriptUri` first searches for a `Student` label and otherwise assumes numeric speaker `1` is the student (`packages/batch-backend/src/application/student-lesson-history.ts`). Anonymous mixed output therefore cannot safely pass Source confirmation today.
6. The existing collapsed `Recording settings` UI already contains the provider selector (`packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`). It is the smallest existing advanced/internal seam for an explicit trusted OBS declaration.
7. Upload-cache reuse currently matches audio SHA-256 plus provider, transcript mode, model, and language, but not topology or request/preparation behavior (`packages/batch-backend/src/transport/extended-routes/recording-provider-cache.ts`).
8. Production ElevenLabs support already uses Scribe v2 and word timestamps, but it first requests multichannel without diarization and may make a second diarized request. It does not set `num_speakers` or `no_verbatim` (`packages/stt-provider-elevenlabs/src/index.ts`).
9. Startup validation checks only one active STT provider (`packages/batch-backend/src/application/validate-transcription-config.ts`), while this design always routes across ElevenLabs and Deepgram.

## Locked Design Decisions

### 1. Supported topology contract

The production slice supports exactly:

```ts
export type AudioInputTopology = 'mixed_recording' | 'trusted_split_channels';
```

This is the currently implemented subset of the approved ingest vocabulary. Do not add `separate_participant_tracks`, `mic_plus_far_end_reference`, or `manual_transcript` to the audio column in this slice. Manual transcript provenance remains represented by `recordings.source = 'manual_transcript'`.

Topology is an explicit source contract, not provider choice:

- ordinary upload: server default `mixed_recording`;
- trusted OBS split: explicit `trusted_split_channels` declaration asserting channel 0 is the tutor and channel 1 is the student;
- no filename, stereo-shape, or acoustic trust inference;
- no automatic topology classifier.

### 2. Persisted topology

Migration `0048_recording_audio_topology.sql` adds:

```sql
audio_topology TEXT NULL
  CHECK (audio_topology IN ('mixed_recording', 'trusted_split_channels'))
```

Rules:

- no database default: upload code owns the ordinary `mixed_recording` default, while manual transcript rows remain `NULL`;
- existing rows remain `NULL`; there is no historical rewrite or speculative backfill;
- new audio uploads persist the resolved topology before queueing;
- retries/reprocesses reuse the persisted topology;
- retrying a legacy `NULL` upload defaults and persists that individual recording as `mixed_recording`, unless the deliberate support action explicitly declares `trusted_split_channels` before enqueueing;
- cache-cloned recordings persist the requested topology, which must already match the cached transcript identity;
- manual transcript ingestion persists `NULL` and never enters STT routing.

`RecordingDto`/`RecordingListItem` gain nullable `audioTopology` so resumed frontend flows use repository truth. This is a backward-compatible API addition and DB addition: update `API_CONTRACT_VERSION` from `4.2.0` to `4.3.0`, `DB_CONTRACT_VERSION` from `0.25.0` to `0.26.0`, and `DB_MIGRATION_HEAD` to `0048_recording_audio_topology`.

### 3. Topology declaration UX

Replace the ordinary provider-first behavior in the existing collapsed `Recording settings` block with:

- `Audio source`: `Ordinary recording` (default, sends no topology parameter) or `Trusted OBS split: channel 1 tutor, channel 2 student` (sends `trusted_split_channels`);
- `Transcript engine`: `Automatic (recommended)` (default, sends no provider) plus the existing providers as an explicitly labelled support/rollback override.

The server treats omitted topology as `mixed_recording`. Selecting the trusted option is the evidence claim; neither the client nor server infers it from the file. Ordinary upload remains upload-and-go and never chooses a provider because job-options metadata supplied a default.

### 4. Provider routing and startup validation

Use one small topology decision function shared by upload cache selection and the worker:

1. an explicit per-request support override, if supplied;
2. the existing optional global `STT_PROVIDER` support/rollback override, if supplied;
3. otherwise `mixed_recording` -> configured mixed provider;
4. otherwise `trusted_split_channels` -> configured trusted-split provider.

Configuration:

- `ESL_STT_DEFAULT_PROVIDER` becomes the mixed/ordinary route and is set/defaulted to `elevenlabs`;
- add `ESL_STT_TRUSTED_SPLIT_PROVIDER`, default `deepgram`;
- keep `STT_PROVIDER` as an explicit global support/rollback override;
- keep `ESL_STT_PROVIDER_ORDER` as metadata/support UI ordering, not ordinary-upload routing.

Production settings are locked to ElevenLabs for mixed and Deepgram for trusted split. In normal topology-routing mode, startup validates credentials and required configuration for every unique configured topology provider (therefore both ElevenLabs and Deepgram). `STT_PROVIDER` is an all-topology emergency override, so it must support every current topology; only `deepgram` is valid. Startup rejects any other global override, validates Deepgram when the override is active, and logs that topology routing is bypassed. Advertised-but-unselected metadata providers do not become topology routes. A per-request support override remains deliberate, topology-scoped, and receives provider-local validation and a distinct cache profile; it is not sent by default UI state.

No cross-provider automatic fallback is introduced.

### 5. Exact provider profiles

Define named, versioned profiles rather than reconstructing cache identity from flags:

- `mixed-recording-elevenlabs-scribe-v2-v1`
  - preparation: existing validated upload bytes, unchanged in this slice;
  - model `scribe_v2`;
  - exactly one application-level `speechToText.convert` call;
  - `useMultiChannel: false`;
  - `diarize: true`;
  - `numSpeakers: 2`;
  - `timestampsGranularity: 'word'`;
  - `noVerbatim: false`;
  - no multichannel-first request and no second diarization fallback.
- `trusted-split-deepgram-nova3-v1`
  - preparation: existing uploaded split artifact;
  - model Nova-3 and existing configured language;
  - multichannel request with explicit channel 0 tutor/channel 1 student semantics;
  - no diarization for a valid trusted split.

For trusted split, a response that does not preserve the declared two-channel contract fails with an actionable topology error instead of silently becoming diarized mixed audio. A tutor may re-upload/retry it as `mixed_recording`; the adapter must not make that identity decision automatically.

Support overrides use an explicit provider/topology-specific profile ID. They never reuse one of the two locked production profiles unless they execute that exact request/preparation contract.

### 6. Cache identity

A cached transcript is reusable only when all of these match:

1. recording audio SHA-256;
2. persisted `audio_topology`;
3. resolved provider;
4. provider model;
5. language;
6. transcript format mode (`timeline` or `stack`);
7. exact versioned `sttRequestProfile` ID.

Persist `audioTopology` and `sttRequestProfile` in transcript `summary_json`. A missing or different profile is a cache miss. Consequently, transcripts produced by the old ElevenLabs multichannel-first behavior cannot satisfy `mixed-recording-elevenlabs-scribe-v2-v1`, even when provider/model/language match.

The profile owns both request flags and the current `validated-upload-bytes-v1` preparation behavior. Any later normalization/downmix/preparation change requires a new profile ID; individual flags are not added piecemeal to cache matching.

### 7. Mixed speaker roles

Mixed STT output is stored initially with anonymous `Speaker 1`, `Speaker 2`, etc. labels in transcript text and speaker-track metadata. Numeric diarization IDs never imply tutor/student roles.

Reuse the existing Source transcript review/confirmation seam:

1. show one Teacher/Student role control for each anonymous speaker found in the current mixed transcript;
2. require the tutor to map every observed anonymous speaker before Source confirmation;
3. save the mapping through the existing transcript working-version update path;
4. deterministically relabel the working transcript to `Teacher`/`Student` and persist a structured mapping in `transcripts.summary_json`;
5. only then permit Source confirmation and lesson-memory generation.

Persist:

```json
{
  "speakerRoleMapping": {
    "version": "speaker-role-mapping-v1",
    "provenance": "tutor_confirmed",
    "confidence": null,
    "roles": [{ "speaker": 0, "role": "teacher" }]
  }
}
```

The mapping update must also make student-track resolution use the structured role mapping. Remove the unconditional `speaker === 1` fallback for `mixed_recording`. Trusted split may continue to resolve student identity from its explicit channel-role metadata.

No probabilistic role inference is implemented. If future inference is authorized, its method/model, per-role confidence, evidence, and provenance belong in `summary_json.speakerRoleMapping`; inferred roles must remain visibly unconfirmed and must not unlock Source confirmation as if tutor-confirmed.

If provider output has missing, extra, or unstable speaker IDs, the UI presents the observed anonymous labels rather than inventing identity. The tutor can map the observed labels or edit the transcript; downstream pedagogical extraction remains blocked until the saved current working version has an explicit mapping.

### 8. Downstream behavior

After tutor mapping, existing downstream contracts remain intact:

- transcript review/persistence continues to use the current text artifact and optimistic working version;
- lesson-memory `Student` extraction and structured `speakerRole` evidence receive truthful labels;
- confirmed prompt/context assembly and homework generation continue to consume the relabelled confirmed transcript;
- lesson-memory, profile/snapshot, prompt package, draft, export, and publication schemas do not change;
- manual transcripts retain their current user-authored labels and bypass mapping enforcement.

## Implementation Slices and Change Surface

### Slice 1: shared topology and additive persistence

- `packages/contracts/src/index.ts`: add the two-value `AudioInputTopology` API type.
- `packages/contracts/src/contract-versions.ts`: API/DB version bumps and migration head.
- `packages/batch-backend/migrations/0048_recording_audio_topology.sql`: nullable checked column, no backfill.
- `packages/batch-backend/schema.sql`: regenerated baseline.
- `packages/batch-backend/src/domain/recording-model.ts`
- `packages/batch-backend/src/domain/recording-repository.ts`
- `packages/batch-backend/src/application/recording-dto.ts`
- `packages/batch-backend/src/application/ingest-recording-upload.ts`
- `packages/batch-backend/src/application/ingest-manual-transcript-source.ts`
- `packages/batch-backend/src/application/retry-recording-transcription.ts`

Carry topology through insert/read/list/clone/retry. Do not add a topology table, PostgreSQL enum, generic classifier, or historical data job.

### Slice 2: routing, profiles, cache, and configuration

- `packages/batch-backend/src/config/env.ts`: mixed/trusted route config and optional hard override.
- `packages/batch-backend/src/application/validate-transcription-config.ts`: validate all configured topology providers.
- `packages/batch-backend/src/application/process-transcribe-job.ts`: load persisted topology, resolve route/profile, pass topology-specific semantics, and persist profile identity.
- `packages/batch-backend/src/transport/extended-routes/recording-provider-cache.ts`: include topology/profile in the fingerprint.
- `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`: ordinary default, explicit trusted declaration, support override, topology-aware cache clone.
- `packages/batch-backend/src/infrastructure/transcribe-queue.ts`: keep provider override optional; the worker treats the recording row as topology authority.

Use a small decision function/constants module if needed by both route and worker. Do not create a routing framework or new provider abstraction.

### Slice 3: exact provider requests and topology-aware formatting

- `packages/stt-core/src/format.ts`: separate anonymous diarized labels from trusted channel-role labels.
- `packages/stt-provider-elevenlabs/src/index.ts`: exact one-call mixed profile.
- `packages/stt-provider-deepgram/src/index.ts`: explicit trusted multichannel mode that fails closed on a broken channel contract.
- `packages/batch-backend/src/application/process-transcribe-job.ts`: choose the appropriate label resolver and speaker-track semantics.

Preserve existing provider registry, canonical segment DTOs, raw-response option, retries already inside the Deepgram transport, storage, and transcript persistence.

### Slice 4: tutor-confirmed role mapping

- `packages/batch-backend/src/application/update-recording-transcript.ts`: accept/validate an optional structured mapping for mixed transcripts, relabel text, update mapping metadata with the same optimistic working-version write.
- `packages/batch-backend/src/domain/transcript-repository.ts`: persist the updated summary JSON together with the working content metadata.
- `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`: additive request schema and authenticated provenance input.
- `packages/batch-backend/src/application/student-lesson-history.ts`: resolve student tracks from explicit topology/role metadata and remove mixed numeric-role fallback.
- `packages/batch-backend/src/domain/assignment-session-repository.ts`: reject mixed Source confirmation unless the current transcript version has a tutor-confirmed mapping.
- `packages/batch-frontend/src/utils/api.ts`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`

Do not add an independent role-inference service or a second review workflow.

### Slice 5: frontend declaration and active docs/config

- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`: topology choice and automatic/support provider control in existing Recording settings.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`: default omission behavior and persisted topology on resume.
- `packages/batch-frontend/src/utils/api.ts`: additive upload/retry topology and nullable response field.
- `.env.example`
- `packages/batch-backend/README.md`
- `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`
- `docs/operations/production-env-checklist.md`
- this topic router/plan lifecycle metadata.

No production Compose topology changes are expected because runtime values remain in the deployment environment. If implementation discovers a Compose allowlist/pass-through for the new variable, update only that existing pass-through and run the deployment checklist validation appropriate to the changed file.

## Acceptance Criteria

1. An upload without topology/provider parameters persists `mixed_recording`, routes to ElevenLabs, and stores `mixed-recording-elevenlabs-scribe-v2-v1`.
2. The ElevenLabs adapter makes one application-level conversion call with Scribe v2, diarization on, multichannel off, two speakers, word timestamps, and verbatim retained.
3. Initial mixed transcript text/tracks contain only anonymous speaker labels; numeric speaker 0/1 is never formatted or consumed as Teacher/Student before explicit mapping.
4. Mixed Source confirmation is rejected until the current working transcript has a tutor-confirmed role mapping; saving the mapping relabels the current transcript and makes lesson-memory student extraction select the mapped student.
5. An explicit trusted OBS declaration persists `trusted_split_channels`, routes to Deepgram Nova-3 multichannel, and retains channel 0 tutor/channel 1 student identity.
6. A trusted-split response that violates the declared channel contract fails clearly and is not silently diarized.
7. Ordinary frontend upload sends neither provider nor topology; trusted mode sends only topology unless the user deliberately selects a support override.
8. Retry/reprocess uses persisted topology; a legacy `NULL` upload is resolved/persisted as mixed unless explicitly declared trusted for that action.
9. Manual transcripts remain `audio_topology = NULL`, bypass STT/mapping enforcement, and retain existing behavior.
10. Old ElevenLabs transcripts without the exact request profile are cache misses. Matching cache clones retain topology/profile identity.
11. In normal topology-routing mode, HTTP server and transcribe worker startup reject missing ElevenLabs or Deepgram credentials/config when those are the configured topology routes; `STT_PROVIDER` is an all-topology emergency override, currently valid only as `deepgram`, and validates/logs that rollback provider.
12. No prompt, homework, lesson-memory content, assignment-session, or publication schema is widened beyond the additive topology/mapping inputs required here.

## Focused Tests

Add or update tests in the established suites:

- `packages/stt-core/tests/format.test.ts`: anonymous vs trusted labels in timeline and stack modes.
- `packages/stt-provider-elevenlabs/tests/index.test.ts`: exact arguments and exactly one conversion call; no fallback call.
- `packages/stt-provider-deepgram/tests/index.test.ts`: trusted multichannel success and fail-closed channel mismatch.
- `packages/batch-backend/tests/config.env.test.ts`
- `packages/batch-backend/tests/application.transcription-startup-validation.test.ts`
- `packages/batch-backend/tests/application.ingest-recording-upload.test.ts`
- `packages/batch-backend/tests/application.retry-recording-transcription.test.ts`
- `packages/batch-backend/tests/domain.recording-repository.test.ts`
- `packages/batch-backend/tests/application.process-transcribe-job.test.ts`
- `packages/batch-backend/tests/transport.extended-routes-provider-cache.test.ts`
- `packages/batch-backend/tests/application.recording-transcript.test.ts`
- `packages/batch-backend/tests/application.student-lesson-history.test.ts`
- `packages/batch-backend/tests/application.assignment-step-confirmation.test.ts`
- `packages/batch-backend/tests/integration.migrations.test.ts`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`: ordinary omission and explicit trusted/support parameters.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`: role mapping gate, save, resume, and manual transcript bypass.

The role tests must include both speaker orderings so no test encodes `0 = Teacher` or `1 = Student` for mixed audio.

## Required Broader Validation

After focused suites pass:

1. `pnpm test:check-routing`
2. `pnpm release:verify:contracts`
3. `pnpm --filter @esl-pipeline/batch-backend run db:generate-baseline`
4. `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline`
5. `pnpm docs:generate:indexes`
6. `pnpm format`
7. `pnpm docs:check`
8. `pnpm check`

`pnpm check` is required because this slice changes both a migration and worker behavior. A separate `check:fast:agent` run is unnecessary after a fresh successful `pnpm check`; use `pnpm --silent run check:fast:agent` earlier only when useful as the contained-change diagnostic gate.

Provider-live and deployment smoke tests require separate authorization. After an authorized deployment, perform one consent-safe ordinary mixed upload and one known trusted OBS split, verify stored topology/profile/provider, verify role mapping/Source confirmation, and confirm one downstream lesson-memory/homework flow. Do not use private benchmark artifacts as deployment smoke fixtures.

## Deployment and Configuration Prerequisites

Before rollout:

- production environment has valid `ESL_STT_PROVIDER_ELEVENLABS_API_KEY` (or documented compatible alias);
- production environment retains valid Deepgram API key/access token;
- `ESL_STT_DEFAULT_PROVIDER=elevenlabs`;
- `ESL_STT_TRUSTED_SPLIT_PROVIDER=deepgram`;
- `ESL_STT_PROVIDER_ELEVENLABS_MODEL=scribe_v2`;
- `ESL_STT_PROVIDER_DEEPGRAM_MODEL=nova-3`;
- migration 0048 is applied before the new API/worker processes traffic;
- API and transcribe-worker images are deployed together so both understand topology/profile identity.

No new secret type, volume, bucket, service, queue, or database is required.

## Rollback and Support Override

- Fast runtime rollback: set `STT_PROVIDER=deepgram` and restart API/worker. This is an explicit operator action and is logged/profiled as an override; it does not erase topology or reuse an incompatible cache entry.
- Per-upload/retry provider selection remains only inside collapsed Recording settings as a deliberate support override; default state is Automatic and emits no provider.
- Schema rollback is forward-compatible: leave the nullable column and metadata in place. Do not down-migrate or rewrite recordings/transcripts during an STT rollback.
- Existing and newly confirmed transcript artifacts remain usable because downstream text/assignment contracts are unchanged.

## Explicit Non-Goals and Deferred Reliability Follow-ups

The following are real pre-existing reliability concerns, but they are not blockers for this provider-adoption slice and must remain separately tracked:

1. general paid-request idempotency or a completed-request ledger;
2. BullMQ duplicate-billing protection after provider success followed by DB/storage failure;
3. general 100 MB ElevenLabs buffering/memory optimization;
4. provider usage/cost observability;
5. generalized STT timeout/duration policy;
6. media probing, transcoding, automatic topology classification, acoustic classification, or a generalized preparation pipeline;
7. probabilistic speaker-role inference;
8. universal provider fallback/routing frameworks;
9. historical topology or speaker-role backfill.

They become blockers only if implementation evidence shows this change creates a new regression rather than exposing the existing limitation. The exact one-call ElevenLabs path, profile cache miss, dual-provider startup validation, and fail-closed trusted identity are in scope and must not be deferred.

## Material Design Uncertainty

None remains. Production credential presence and an authorized post-deploy smoke are rollout prerequisites, not unresolved design decisions.
