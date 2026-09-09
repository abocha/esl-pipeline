# Project Overview (Agent Baseline)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 3 minutes.
- Authority Level: Context baseline.
- Last Verified Against: 2026-09-09 recording-ingest closeout state.
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
- Batch system is active through the five-step assignment builder: Student, Lesson source, Teaching
  context, Create, and Review & share.
- Lesson sources may be supported direct-audio/cheap-demux recording uploads or tutor-pasted
  transcripts; both remain workspace/student-owned and converge on the same prompt, draft, approval,
  and publish pipeline.
- Prompt runtime in batch flow is owned by `batch-backend`: the prompt catalog is DB-canonical, with
  bootstrap tooling for fresh environments.
- Student-memory extraction, review, health inspection, and replay tooling are backend-owned; the
  frontend exposes the tutor and support surfaces without inventing durable state.
- Operations documentation routes through [`docs/operations/README.md`](operations/README.md), with
  current procedures actively maintained under `docs/operations`.

## Component Map

- Pipeline: `orchestrator`, `md-validator`, and `pmd` own execution, validation, and parsing.
- Provider runtime: `provider-runtime`, `tts-core`, `tts-provider-*`, `stt-core`, and
  `stt-provider-*` own provider contracts and adapters.
- Product runtime: `contracts`, `shared-infrastructure`, `batch-backend`, `batch-frontend`, and
  `telegram-ops-bot` own DTOs, shared runtime support, API/workers, UI, and optional ops bot.
- Publishing: `html-publisher` and `storage-uploader` own rendered artifacts and storage.

## Do / Don't

- Do use docs for orientation and status before edits.
- Do confirm task-specific contracts in SSOT before implementation.
- Don't infer current behavior from archive docs.

## Related

- [`docs/README.md`](README.md)
- [`docs/QUICK_START.md`](QUICK_START.md)
- [`docs/reference/DOCS_IA_MAP.md`](reference/DOCS_IA_MAP.md)
- [`docs/operations/README.md`](operations/README.md)
