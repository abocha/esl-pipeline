# @esl-pipeline/contracts

Shared cross-package TypeScript contracts for the ESL monorepo.

## Includes

- Job/request DTOs (`SubmitJobRequest`, `JobStatusDto`, summaries, events)
- Recording DTOs and product state, including canonical run state/error projection plus
  `audioLifecycle` and `audioAvailable`
- The shared 2 GiB browser/backend default guard and 10 GiB backend temp-disk reserve constants
- Shared enums/unions (`JobState`, `TtsStrategy`, `JobUploadOption`, `PublishTarget`)
- Job action types (`JobActionType`, `JobActionRequest`, `JobActionResponse`, `ActionCapability`)
- Job options metadata payload types (`JobOptionsPayload`, `VoiceOption`)
- WS2B generation DTOs (`GenerateDraftRequest`, `GenerateDraftResponse`, provider/model/quota types)
- `AssignmentV1` runtime/read union (legacy root rationale or explicit learner/teacher rationale,
  independently accepting legacy output tasks or structured mission roles, and each grammar item
  as closed legacy scalar form or structured form blocks with paired contrasts),
  new-shape-only fresh-generation admission and strict provider projection; see
  [the assignment contract](../../docs/reference/ASSIGNMENT_V1.md).
- Shared errors (`PipelineError`, `ConfigurationError`, etc.)
- Shared observability shapes (`PipelineLogEvent`, `PipelineLogger`, `noopLogger`)
- Semantic contract version registry (`CONTRACT_VERSIONS`)

## Notes

- This package is the canonical source for cross-boundary types used by:
  - `@esl-pipeline/orchestrator`
  - `@esl-pipeline/batch-backend`
  - `@esl-pipeline/batch-frontend`
  - publishing and infrastructure packages
- Keep runtime behavior out of this package; contracts should remain stable and serializable.
- Recording `productState` is `checking`, `waiting`, `transcribing`, `retrying`, `ready`, or
  `attention`; polling, SSE, upload reconciliation, and resume consume the same projection.
- Stable recording failure codes are `file_too_large`, `insufficient_upload_capacity`,
  `recording_too_long`, `no_audio`, `corrupt_media`, `unsupported_media`,
  `multiple_audio_streams`, `preparation_failed`, `speakers_not_separated`, and
  `transcription_provider_account_unavailable`, and `transcription_unavailable_after_retries`.
