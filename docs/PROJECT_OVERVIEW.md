# Project Overview (Agent Baseline)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 3 minutes.
- Authority Level: Context baseline.
- Last Verified Against: 2026-03-04 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly.
- Status: `active`.

## Purpose

- Provide baseline understanding of repository components.
- Define where implementation authority lives before coding starts.

## Canonical Sources

1. [`AGENTS.md`](../AGENTS.md)
2. [`docs/reference/agents-ssot.md`](reference/agents-ssot.md)
3. [`docs/backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)
4. [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend/backend-frontend-alignment.md)

## Current State

- Monorepo with orchestrator-centric pipeline architecture.
- Batch system is active for recording -> transcript -> prompt -> draft -> publish workflows.
- Prompt runtime in batch flow is DB-canonical with bootstrap tooling.
- Operations runbooks are actively maintained under `docs/operations`.

## Component Map

- `packages/orchestrator`: pipeline assembly and programmatic API entrypoints (legacy CLI is deprecated).
- `packages/md-validator`: markdown validation.
- `packages/pmd`: PMD parsing and study-text extraction.
- `packages/notion-adapter`: Notion import + formatting + audio attach.
- `packages/tts-core`: TTS provider registry + shared contracts.
- `packages/tts-provider-elevenlabs`: ElevenLabs TTS provider adapter.
- `packages/tts-provider-google`: Google Cloud TTS provider adapter.
- `packages/storage-uploader`: upload adapter support.
- `packages/html-publisher`: HTML rendering/publishing helpers.
- `packages/provider-runtime`: provider policy/runtime helpers.
- `packages/batch-backend`: authenticated API + workers + queue processing.
- `packages/batch-frontend`: assignment console.

## Do / Don't

- Do use docs for orientation and status before edits.
- Do confirm task-specific contracts in SSOT before implementation.
- Don't infer current behavior from archive docs.

## Related

- [`docs/README.md`](README.md)
- [`docs/QUICK_START.md`](QUICK_START.md)
- [`docs/reference/DOCS_IA_MAP.md`](reference/DOCS_IA_MAP.md)
