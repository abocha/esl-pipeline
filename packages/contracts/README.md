# @esl-pipeline/contracts

Shared cross-package TypeScript contracts for the ESL monorepo.

## Includes

- Job/request DTOs (`SubmitJobRequest`, `JobStatusDto`, summaries, events)
- Shared enums/unions (`JobState`, `TtsStrategy`, `JobUploadOption`, `PublishTarget`)
- Job action types (`JobActionType`, `JobActionRequest`, `JobActionResponse`, `ActionCapability`)
- Job options metadata payload types (`JobOptionsPayload`, `VoiceOption`, `NotionDatabaseOption`)
- WS2B generation DTOs (`GenerateDraftRequest`, `GenerateDraftResponse`, provider/model/quota types)
- Shared errors (`PipelineError`, `ConfigurationError`, etc.)
- Shared observability shapes (`PipelineLogEvent`, `PipelineLogger`, `noopLogger`)
- Contract version registry (`CONTRACT_VERSIONS`, `DB_MIGRATION_HEAD`)

## Notes

- This package is the canonical source for cross-boundary types used by:
  - `@esl-pipeline/orchestrator`
  - `@esl-pipeline/batch-backend`
  - `@esl-pipeline/batch-frontend`
  - adapters and infrastructure packages
- Keep runtime behavior out of this package; contracts should remain stable and serializable.
