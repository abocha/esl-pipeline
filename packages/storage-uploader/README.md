# @esl-pipeline/storage-uploader

S3 artifact uploader for pipeline-generated files.

Callers may request a temporary MP3 metadata remux before upload. This is used by the orchestrator
for student-facing primary audio exports while preserving the original generated cache artifact.

## CLI

```
pnpm --filter @esl-pipeline/storage-uploader exec storage-uploader --file ./out/lesson.mp3 [--public]
```

Outputs JSON containing the derived key and URL.

## Environment

- CLI auto-loads `.env` from the current working directory and repo root.
- `S3_BUCKET`
- `S3_PREFIX`

When unset, defaults are used for predictable development behaviour.
