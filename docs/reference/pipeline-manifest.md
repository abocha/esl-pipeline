# Pipeline Manifest Schema

The orchestrator persists a manifest next to each Markdown lesson (or via a configured `ManifestStore`).
This document captures the canonical schema so remote stores and services can validate their payloads.

## Schema Versioning

- **Current version:** `1`
- Every manifest written by the pipeline now includes `schemaVersion: 1`.
- Older manifests (created before versioning) are treated as version `1` when read; the orchestrator
  will automatically annotate the field when rewriting the manifest.
- Future breaking changes to the manifest structure must bump `CURRENT_MANIFEST_SCHEMA_VERSION` in
  `packages/orchestrator/src/manifest.ts` and extend this document with migration guidance.

## JSON Structure (v1)

```jsonc
{
  "schemaVersion": 1,
  "mdHash": "<sha256 hash of the Markdown study text>",
  "timestamp": "2024-07-19T12:34:56.789Z",
  "preset": "b1-default", // optional, last applied heading preset
  "notionColorization": {
    // optional, persisted when Notion preset colorization is applied
    "preset": "b1-default",
    "presetHash": "<sha256 hash of normalized preset payload>",
    "pageId": "<notion-page-id>",
    "mdHash": "<sha256 hash of markdown used for colorization>",
    "appliedAt": "2024-07-19T12:30:00.000Z"
  },
  "pageId": "<notion-page-id>", // optional, populated after Notion import
  "pageUrl": "https://www.notion.so/...", // optional, populated after Notion import
  "audio": {
    // optional, populated after TTS/upload steps
    "path": "./lessons/audio.mp3", // local file path to generated audio
    "url": "https://...", // remote URL after upload
    "hash": "<sha256 audio hash>",
    "key": "audio/final/<sha256>.mp3", // optional remote object key
    "etag": "\"abc123...\"", // optional remote ETag from storage backend
    "sizeBytes": 123456, // optional uploaded object size
    "reused": true, // optional reuse signal for idempotent uploads
    "voices": [
      // details returned by tts-elevenlabs
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
- `audio.voices` mirrors the response from `@esl-pipeline/tts-elevenlabs`; the structure is defined
  in that package.
- `audio.key`/`audio.hash` provide deterministic artifact identity for reruns and upload dedupe.
- `audio.reused` and `htmlReused` are operational hints showing whether remote upload/publish reused
  an existing content-addressed object.
- `notionColorization` captures the Notion preset fingerprint used for idempotent colorization skip
  decisions. Consumers SHOULD treat the object as optional and additive.
- When `notionColorization.presetHash`/`mdHash` still match the current run context, orchestrator may
  skip colorization calls to avoid redundant Notion API churn while preserving manifest provenance.
- `audio.voices[*].selectionReason`, `capabilityMatches`, and `capabilityMismatches` are additive
  explainability fields for voice-alignment v2. Consumers SHOULD treat them as optional.
- `ttsStrategy` and related dialogue fields capture the TTS strategy used for reproducibility. These fields
  are optional and additive under schema version `1`.

## Backwards Compatibility

- Services should tolerate unknown fields to allow additive evolution.
- When reading manifests without `schemaVersion`, assume version `1`. The orchestrator already
  applies this fallback when parsing legacy files.
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
