# @esl-pipeline/orchestrator

Stubbed end-to-end runner for the ESL pipeline. It sequences validation, import, colorization, optional TTS generation, uploads, audio attachment, and manifest creation. Each step currently returns fabricated data so downstream tooling can be developed without real Notion or AWS calls.

## CLI

```
pnpm cli:orchestrator --md ./lessons/unit1.md [--student "Student"] [--preset default] [--with-tts] [--upload s3] [--dry-run]
```

Outputs JSON summarising the steps executed, fake Notion identifiers, and the manifest path.

## Manifest helper

`manifest.ts` exposes `writeManifest`, `readManifest`, and `manifestPathFor` for re-use by other tools. Manifest shape:

```
{
  mdHash: string,
  pageId?: string,
  pageUrl?: string,
  audio?: { path?: string; url?: string; hash?: string },
  preset?: string,
  timestamp: string
}
```

## TODO

- Wire into the real validator, importer, colorizer, uploader, and audio injection steps.
- Surface richer status/error handling and integrate workspace configuration.
