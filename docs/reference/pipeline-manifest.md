# Pipeline Manifest Schema

## Meta

- Audience: maintainers and implementing agents.
- Read Time: 6 minutes.
- Authority Level: canonical manifest schema reference.
- Last Verified Against: 2026-03-10 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly or after manifest schema changes.
- Status: `reference`.

The orchestrator persists a manifest next to each Markdown lesson (or via a configured `ManifestStore`).
This document captures the canonical schema so remote stores and services can validate their payloads.

## Schema Versioning

- **Current version:** `2`
- Every manifest written by the pipeline now includes `schemaVersion: 3`.
- Older manifests without `schemaVersion` are treated as legacy version `1` when read.
- Future breaking changes to the manifest structure must bump `CURRENT_MANIFEST_SCHEMA_VERSION` in
  `packages/orchestrator/src/manifest.ts` and extend this document with migration guidance.

## JSON Structure (v2)

```jsonc
{
  "schemaVersion": 3,
  "mdHash": "<sha256 hash of the Markdown study text>",
  "timestamp": "2024-07-19T12:34:56.789Z",
  "preset": "b1-default", // optional, last applied heading preset
  "notionColorization": {
    // optional, persisted when Notion preset colorization is applied
    "preset": "b1-default",
    "presetHash": "<sha256 hash of normalized preset payload>",
    "pageId": "<notion-page-id>",
    "mdHash": "<sha256 hash of markdown used for colorization>",
    "appliedAt": "2024-07-19T12:30:00.000Z",
  },
  "pageId": "<notion-page-id>", // optional, populated after Notion import
  "pageUrl": "https://www.notion.so/...", // optional, populated after Notion import
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
      "notionBlockId": "<notion-block-id>",
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
        "notionBlockId": "<notion-block-id>"
      },
      "itemClips": [
        {
          "id": "shadow-word-1-edge",
          "kind": "word_item",
          "engine": "edge",
          "itemIndex": 0,
          "text": "review",
          "path": "./lessons/audio-pronunciation-item.mp3",
          "url": "https://..."
        }
      ]
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

- `mdHash` is produced by `hashStudyText` and enables idempotence/skip logic.
- `timestamp` reflects the last pipeline write and is updated on reruns.
- `audioArtifacts.studyText.voices` mirrors the response from `@esl-pipeline/tts-core` provider contracts; provider
  adapters compute values in that shared shape.
- `audioArtifacts.studyText.tts` is optional usage telemetry: generated vs cached provider characters plus optional
  cost estimate fields when pricing env vars are configured.
- `audioArtifacts.studyText.key`/`audioArtifacts.studyText.hash` provide deterministic artifact identity for reruns and upload dedupe.
- `audioArtifacts.studyText.reused` and `htmlReused` are operational hints showing whether remote upload/publish reused
  an existing content-addressed object.
- `audioArtifacts` stores per-target audio artifacts:
  - `audioArtifacts.studyText` for primary study-text audio.
  - `audioArtifacts.pronunciation` for canonical pronunciation audio, including the primary section clip and optional item clips.
- `audioArtifacts.*.notionBlockId` is optional and lets reruns replace only previously inserted
  generated audio blocks near semantic anchors.
- `notionColorization` captures the Notion preset fingerprint used for idempotent colorization skip
  decisions. Consumers SHOULD treat the object as optional and additive.
- When `notionColorization.presetHash`/`mdHash` still match the current run context, orchestrator may
  skip colorization calls to avoid redundant Notion API churn while preserving manifest provenance.
- `audioArtifacts.studyText.voices[*].selectionReason`, `capabilityMatches`, and `capabilityMismatches` are additive
  explainability fields for voice-alignment v2. Consumers SHOULD treat them as optional.
- `ttsStrategy` and related dialogue fields capture the TTS strategy used for reproducibility. These fields
  are optional and additive under schema version `3`.

## Backwards Compatibility

- Services should tolerate unknown fields to allow additive evolution.
- When reading manifests without `schemaVersion`, the orchestrator treats them as legacy version `1`.
- Runtime logic is canonicalized to `audioArtifacts.*`; legacy manifests that only contain top-level `audio`
  do not get implicit alias fallback and should be regenerated to schema `2`.
- Remote stores should persist manifests verbatim to avoid losing optional fields used by other
  stages (e.g., future metadata for adapters).

## Future Changes

- Introducing new optional fields does **not** require a schema bump.
- Removing/renaming fields or altering semantics **does** require a bump and migration steps.
- When bumping the schema, capture upgrade instructions here and consider providing a migration script.

## Migrating from Filesystem to S3

1. Ensure manifests on disk are up to date (rerun the pipeline or copy existing `.manifest.json` files).
2. Configure the worker/process with:
   - `ESL_PIPELINE_MANIFEST_STORE=s3`
   - `ESL_PIPELINE_MANIFEST_BUCKET=<bucket-name>`
   - Optional: `ESL_PIPELINE_MANIFEST_PREFIX` and `ESL_PIPELINE_MANIFEST_ROOT` for custom layout.
3. Copy historical manifests to the matching S3 prefix (`.manifest.json` files can be uploaded as-is).
4. Restart the pipeline worker; new runs will write and read manifests from S3. Filesystem manifests remain untouched for fallback.
