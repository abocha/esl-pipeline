# @esl-pipeline/storage-uploader

S3 artifact uploader for pipeline-generated files.

Callers may request a temporary MP3 metadata remux before upload. This is used by the orchestrator
for student-facing primary audio exports while preserving the original generated cache artifact.

## CLI

```
pnpm --filter @esl-pipeline/storage-uploader exec storage-uploader --file ./out/lesson.mp3 [--prefix lessons] [--public-read] [--presign 3600]
```

Outputs JSON containing the derived key and URL.
Use `--help` to list options. `--file` is required; `--presign` accepts a positive integer number of seconds.

## Environment

- CLI auto-loads `.env` from the current working directory and repo root.
- `S3_BUCKET`
- `S3_PREFIX`

When unset, defaults are used for predictable development behaviour.
