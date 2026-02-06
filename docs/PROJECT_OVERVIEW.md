# ESL Pipeline Project Overview

ESL Pipeline automates the flow from lesson recording to published homework.
Core system path: record -> transcribe -> assemble -> review -> publish.

## Maintainer Reading Order

1. `docs/README.md`
2. `docs/reference/agents-ssot.md`
3. `docs/backend-frontend/BATCH_SYSTEM.md`
4. `docs/backend-frontend/backend-frontend-alignment.md`
5. `packages/batch-frontend/README.md` and `packages/batch-backend/README.md`

## What The System Does

- Accepts lesson inputs (markdown and recording artifacts)
- Produces transcript and prompt-package artifacts
- Supports tutor review/edit before publishing
- Runs orchestrator pipeline (validation, import, optional TTS, upload, manifest)

## Primary User

Private ESL tutors who need personalized homework built from real lesson context.

## Current Product Shape

- Frontend: minimal authenticated assignment console (`@esl-pipeline/batch-frontend`)
- Backend: extended API + queue-backed processing (`@esl-pipeline/batch-backend`)
- Pipeline runtime: orchestrator + adapters (`@esl-pipeline/orchestrator` and related packages)

## Operational References

- System guide: `docs/backend-frontend/BATCH_SYSTEM.md`
- API/status tracker: `docs/backend-frontend/backend-frontend-alignment.md`
- Transcription spec: `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`
- Integration manual: `docs/PIPELINE_INTEGRATION_VISION.md`

## Historical Material

Earlier frontend vision and phased implementation docs are intentionally archived.
Use `docs/archive/` when researching prior direction, not for current implementation rules.
