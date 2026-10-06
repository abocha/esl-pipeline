# Pipeline Manifest Schema

## Meta

- Audience: maintainers and implementing agents.
- Read Time: 6 minutes.
- Authority Level: canonical manifest schema reference.
- Last Verified Against: 2026-10-04 ESL-6 local implementation.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly or after manifest schema changes.
- Status: `reference`.

The orchestrator persists a manifest at each assignment’s stable manifest locator (or via a configured `ManifestStore`).
This document captures the canonical schema so remote stores and services can validate their payloads.

## Schema Versioning

- **Current native version:** `6`; schemas `1`–`5` are read-only historical evidence. Legacy execution/writes are retired.
- Schema 6 adds canonical `assignmentHash` and versioned `publication` metadata. Its `mdHash`
  equals the canonical AssignmentV1 hash. Schema 1–5 `mdHash` retains Markdown semantics.
- Native manifests retain the same audio/cast/speech-plan fields and historical readers.
- Manifest contract version is `4.0.0`. No database migration is required.
- Filesystem reads tag older manifests without `schemaVersion` as legacy version `1`; remote stores
  preserve the omitted version while remaining schema-compatible.
- Future breaking changes to the manifest structure must bump `CURRENT_MANIFEST_SCHEMA_VERSION` in
  `packages/orchestrator/src/manifest.ts` and extend this document with migration guidance.

## JSON Structure (v6; audio/plan fields also readable in v5)

```jsonc
{
  "schemaVersion": 6,
  "assignmentHash": "<canonical AssignmentV1 sha256>",
  "mdHash": "<same canonical AssignmentV1 sha256>",
  "publication": {
    "schemaVersion": 1,
    "rendererVersion": 3,
    "title": "Homework Assignment: Clear demos",
    "icon": "🎧",
    "studyTextAudioUrl": "https://...", // null when absent
    "pronunciationAudioUrl": null, // primary sentence only; never an item clip
  },
  "timestamp": "2024-07-19T12:34:56.789Z",
  "preset": "b1-default", // optional, last applied heading preset
  "publishTarget": "html",
  "audioArtifacts": {
    // optional multi-artifact map (canonical in schema v2)
    "studyText": {
      "path": "./lessons/audio.mp3",
      "url": "https://...",
      "hash": "<sha256 audio hash>",
      "key": "audio/final/<sha256>.mp3",
      "etag": "\"abc123...\"",
      "sizeBytes": 123456,
      "reused": true,
      "voicePlanHash": "<sha256 neutral voice-plan hash>",
      "speechPlanHash": "<sha256 neutral speech-plan hash>",
      "voices": [
        {
          "speaker": "Narrator",
          "voiceId": "voice-id",
          "voiceName": "Caleb",
          "source": "voiceMap",
          "gender": "male",
          "accent": "american",
          "score": 0.92,
          "selectionReason": "Matched explicit speaker_profiles.voice override",
          "capabilityMatches": ["gender:male", "accent:american"],
          "capabilityMismatches": [],
        },
      ],
      "tts": {
        "provider": "elevenlabs",
        "generatedCharacters": 1320,
        "cachedCharacters": 480,
        "costPer1kCharsUsd": 0.3,
        "estimatedSpendUsd": 0.396,
      },
    },
    "pronunciation": {
      "mode": "shadow_sentence",
      "primaryClip": {
        "id": "primary-shadow-sentence",
        "kind": "shadow_sentence",
        "engine": "provider",
        "text": "We should review this carefully.",
        "path": "./lessons/audio-shadow.mp3",
        "url": "https://...",
        "hash": "<sha256 pronunciation sentence hash>",
        "key": "audio/pronunciation/<sha256>.mp3",
        "voiceId": "<provider-voice-id>",
      },
      "itemClips": [
        {
          "id": "shadow-word-1",
          "kind": "word_item",
          "engine": "provider",
          "itemIndex": 0,
          "text": "review",
          "path": "./lessons/audio-pronunciation-item.mp3",
          "url": "https://...",
        },
      ],
    },
  },
  "voicePlans": {
    "studyText": {
      "schemaVersion": 1,
      "capabilityPolicyVersion": "model-scoped-v1",
      "provider": "inworld",
      "model": "inworld-tts-2",
      "sourceHash": "<sha256 prepared source hash>",
      "assignments": [
        {
          "speaker": "Narrator",
          "voiceId": "voice-id",
          "language": "en-US",
          "source": "auto",
          "capabilities": {
            "supportsMetadataInstructions": true,
            "supportsNonVerbals": true,
            "supportsUppercaseEmphasis": true,
            "supportsFreeFormDirection": true,
          },
        },
      ],
    },
  },
  "speechPlans": {
    "studyText": {
      "schemaVersion": 1,
      "provider": "inworld",
      "model": "inworld-tts-2",
      "sourceHash": "<sha256 prepared source hash>",
      "mode": "prompted",
      "planner": {
        "provider": "google",
        "model": "gemini-3.1-flash-lite",
        "generatedAt": "2026-07-28T00:00:00.000Z",
        "promptPolicyVersion": "speech-performance-v2-inworld-tts2",
        "promptHash": "<sha256 immutable prompt hash>",
      },
      "segments": [],
    },
  },
  // TTS metadata (additive, optional)
  "ttsStrategy": "dialogue",
  "dialogueLanguage": "en",
  "dialogueStability": 0.7,
  "dialogueSeed": 42,
  // HTML publish artifact metadata (optional, additive)
  "htmlHash": "<sha256 html artifact hash>",
  "htmlKey": "materials/html/artifacts/<sha256>.html",
  "htmlEtag": "\"etag-from-store\"",
  "htmlReused": true,
}
```

### Field Notes

- `mdHash` is produced by `hashStudyText` and enables idempotence/skip logic. Schema 6 hashes
  canonical AssignmentV1 bytes; historical schemas hash their Markdown source.
- `assignmentHash` identifies the frozen typed object. `publication` is direct sharing metadata;
  legacy manifests without it remain readable and typed DTOs derive title from frozen JSON.
- `timestamp` reflects the last pipeline write and is updated on reruns.
- `audioArtifacts.studyText.voices` mirrors the response from `@esl-pipeline/tts-core` provider contracts; provider
  adapters compute values in that shared shape.
- `audioArtifacts.studyText.tts` is optional usage telemetry: generated vs cached provider characters plus optional
  cost estimate fields when pricing env vars are configured.
- `audioArtifacts.studyText.key`/`audioArtifacts.studyText.hash` provide deterministic artifact identity for reruns and upload dedupe.
- `voicePlans.studyText` stores provider-neutral cast selection and per-assignment capability
  provenance. The matching `audioArtifacts.studyText.voicePlanHash` links generated study-text
  audio to the consumed cast. New plans carry `capabilityPolicyVersion: model-scoped-v1`; each
  assignment may carry its canonical provider language (for example, `en-US`).
- `speechPlans.studyText` stores validated provider-neutral delivery provenance. The matching
  `audioArtifacts.studyText.speechPlanHash` links generated study-text audio to the consumed plan.
  Schema-v1 planner provenance optionally records the immutable policy ID and SHA-256 prompt hash.
  The supported prompt policy IDs are `speech-performance-v1-restrained-natural`,
  `speech-performance-v2-inworld-tts2`, and
  `contextual-bracket-annotation-v1`.
- Schema-v2 `speechPlans.studyText` adds `enhancerVersion` and ordered segments containing canonical
  authored `text` plus validated TTS-only `synthesisText`. Optional `planner.returnedModel` remains
  provenance. These fields are additive under manifest schema `5`; annotations never replace
  learner-visible assignment content.
- `audioArtifacts.studyText.reused` and `htmlReused` are operational hints showing whether remote upload/publish reused
  an existing content-addressed object.
- `audioArtifacts` stores per-target audio artifacts:
  - `audioArtifacts.studyText` for primary study-text audio.
  - `audioArtifacts.pronunciation` for canonical pronunciation audio, including the primary section clip and optional item clips.
- `audioArtifacts.pronunciationShadowSentence` remains readable as the legacy shadow-sentence field;
  new writes use the canonical `audioArtifacts.pronunciation` shape.
- `publishTarget` is now html-only and retained for explicit manifest provenance.
- `audioArtifacts.studyText.voices[*].selectionReason`, `capabilityMatches`, and `capabilityMismatches` are additive
  explainability fields for voice-alignment v2. Consumers SHOULD treat them as optional.
- `ttsStrategy` and related dialogue fields capture the TTS strategy used for reproducibility. These fields
  are optional and additive under schema version `3`.

## Backwards Compatibility

- Services should tolerate unknown fields to allow additive evolution.
- Filesystem reads tag manifests without `schemaVersion` as legacy version `1`; S3 reads preserve an omitted version.
- Runtime logic is canonicalized to `audioArtifacts.*`; legacy manifests that only contain top-level `audio`
  do not get implicit alias fallback and should be regenerated to the current schema `5`.
- Manifest stores persist the supported shape after `sanitizeAssignmentManifest`; optional fields declared
  here must remain preserved by storage adapters.
- The optional voice, schema-v2 envelope, returned-model, and prompt-policy fields are additive.
  Unversioned schema-v1 plans remain readable and are not rewritten with invented markers or
  hashes. At execution time, legacy Inworld capability snapshots are normalized against the
  selected model; the derived runtime log label `legacy-unversioned-v1` is not persisted into the
  manifest.

## Future Changes

- Introducing new optional fields does **not** require a schema bump.
- Removing/renaming fields or altering semantics **does** require a bump and migration steps.
- When bumping the schema, capture upgrade instructions here and consider providing a migration script.

## Schema Version 4

The speech-performance rollout adds optional `speechPlans.studyText` provenance and
`audioArtifacts.studyText.speechPlanHash`. Study-text audio caching includes the plan hash and
provider-rendered controls. Older manifests without plans remain readable and reusable.

See [`docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`](TTS_SPEECH_PERFORMANCE_SYSTEM.md).

## Schema Version 5

The capability-tiered Inworld rollout adds optional `voicePlans.studyText` provenance and
`audioArtifacts.studyText.voicePlanHash`. The voice plan records the selected cast and compact
capability snapshots before speech planning. Older manifests without voice plans remain readable
and reusable.

The manifest contract version `3.1.0` added optional model-scoped capability provenance, canonical
assignment language, and immutable planner prompt-policy provenance. Contract version `3.2.0`
adds schema-v2 contextual annotation plans and exact returned-model provenance. Neither change
bumps manifest schema version `5` or alters schema-v1 compatibility.

## Migrating from Filesystem to S3

1. Ensure manifests on disk are up to date (rerun the pipeline or copy existing `.manifest.json` files).
2. Configure the worker/process with:
   - `ESL_PIPELINE_MANIFEST_STORE=s3`
   - `ESL_PIPELINE_MANIFEST_BUCKET=<bucket-name>`
   - Optional: `ESL_PIPELINE_MANIFEST_PREFIX` and `ESL_PIPELINE_MANIFEST_ROOT` for custom layout.
3. Copy historical manifests to the matching S3 prefix (`.manifest.json` files can be uploaded as-is).
4. Restart the pipeline worker; new runs will write and read manifests from S3. Filesystem manifests remain
   untouched, and invalid or missing S3 configuration fails rather than falling back to filesystem storage.
