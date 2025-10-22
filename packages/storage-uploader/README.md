# @esl-pipeline/storage-uploader

Stub uploader that fabricates an S3 URL for a file without performing any network operations.  
Future work will stream files to S3 (or alternative backends) and return metadata such as ETag, signed URLs, and expiry.

## CLI

```
pnpm cli:uploader --file ./out/lesson.mp3 [--public]
```

Outputs JSON containing the derived key and URL.

## Environment

- `S3_BUCKET`
- `S3_PREFIX`

When unset, defaults are used for predictable development behaviour.
