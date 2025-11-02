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
  "preset": "b1-default",             // optional, last applied heading preset
  "pageId": "<notion-page-id>",       // optional, populated after Notion import
  "pageUrl": "https://www.notion.so/...", // optional, populated after Notion import
  "audio": {                          // optional, populated after TTS/upload steps
    "path": "./lessons/audio.mp3",   // local file path to generated audio
    "url": "https://...",            // remote URL after upload
    "hash": "<sha256 audio hash>",
    "voices": [                       // details returned by tts-elevenlabs
      {
        "speaker": "Narrator",
        "voiceId": "voice-id",
        "voiceName": "Caleb",
        "source": "voiceMap",
        "gender": "male",
        "accent": "american",
        "score": 0.92
      }
    ]
  }
}
```

### Field Notes

- `mdHash` is produced by `hashStudyText` and enables idempotence/skip logic.
- `timestamp` reflects the last pipeline write and is updated on reruns.
- `audio.voices` mirrors the response from `@esl-pipeline/tts-elevenlabs`; the structure is defined
  in that package.

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
