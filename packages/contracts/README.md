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
  new-shape-only fresh-generation admission and strict v8 provider projection (required authored
  `metadata.icon` emoji, optional only on reads), plus bounded paired-backtick content parts and
  derived plain speech projections; see
  [the assignment contract](../../docs/reference/ASSIGNMENT_V1.md).
- Shared errors (`PipelineError`, `ConfigurationError`, etc.)
- `StudentMemoryAvailability` and its closed runtime schema: aggregate `state`, bounded `reason`,
  `lessonReferenceCount` and `homeworkReferenceCount`. States are `absent`, `available`,
  `repair_required`, and `repository_unavailable`; counts never assert completeness or mastery.
  Memory overview/health, teaching context and transcript progress share this projection. MCP
  `get_student_teaching_context` adds required result-level `availability` alongside `context`;
  the nested `mcp_teaching_context.v1` payload/allowlist is unchanged. Existing consumers may ignore
  the additive result field; new frontend readers tolerate its absence on older API responses.
- Student activity DTOs (`StudentActivityItem`, `StudentActivityResponse`) for the additive
  student-authorized pageable feed, with explicit recorded/retained/legacy evidence,
  factual details and related effects. The legacy timeline DTO remains available. API 11.4 /
  DB 4.1 add this surface without changing billing or transcript completion semantics.
- Shared observability shapes (`PipelineLogEvent`, `PipelineLogger`, `noopLogger`)
- Semantic contract version registry (`CONTRACT_VERSIONS`)
- Session homework intent, current completion kind/timestamp, immutable exact-source finish
  events, finish/promotion commands and separate transcript-processing status. Lesson homework
  projections include `not_planned` and a nullable transcript-result session reference. API 10 / DB 4
  mark the completion/admission and incompatible-writer boundary; frozen AssignmentV1, manifest,
  prompt and validator contracts remain unchanged.

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

ESL-41 advances API to 11: fresh generation and operator selections admit only OpenAI. The
`GenerationProvider` union retains retired Google/OpenRouter identifiers for stored provenance and
read projections. DB 4, manifest 4, prompt 3 and validator 3 remain unchanged.
