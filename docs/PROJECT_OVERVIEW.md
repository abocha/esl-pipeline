# Project Overview (Agent Baseline)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 3 minutes.
- Authority Level: Context baseline.
- Last Verified Against: 2026-02-28 repo state.

## Purpose

- Provide baseline understanding of the repository and major components.
- Define where implementation authority lives before coding starts.

## When To Read

- Before first task in this repo.
- When switching between pipeline, backend, and frontend tasks.

## Canonical Sources

1. `AGENTS.md` (core rules).
2. `docs/reference/agents-ssot.md` (contracts/invariants).
3. `docs/backend-frontend/BATCH_SYSTEM.md` (active integration map).
4. `docs/backend-frontend/backend-frontend-alignment.md` (live status).
5. `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md` (product direction and launch readiness gates).
6. `docs/reference/PRESET_V2_SPEC.md` (canonical learning-preset architecture and MVP scope lock).
7. `docs/reference/V1_IMPLEMENTATION_TRACKER.md` (execution checklist and stage-gate mapping).
8. `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md` (weekly scorecard and reality check cadence).
9. `docs/playbooks/RESTART_TOMORROW.md` (low-friction re-entry when context is overloaded).

## Current State

- Monorepo with orchestrator-centric pipeline architecture.
- Batch system has active minimal frontend workflow and queue-backed backend.
- Documentation is archive-first for stale material and active-playbook for current guidance.

## Component Map

- `packages/orchestrator`: pipeline assembly and CLI/API entrypoints.
- `packages/md-validator`: markdown validation.
- `packages/pmd`: PMD parsing and study-text extraction.
- `packages/notion-adapter`: Notion import + formatting + audio attach.
- `packages/tts-elevenlabs`: TTS generation.
- `packages/storage-uploader`: upload adapter support.
- `packages/batch-backend`: authenticated API + workers + queue processing.
- `packages/batch-frontend`: minimal assignment console.

## Do / Don't

- Do use docs for orientation and status before code edits.
- Do confirm task-specific contracts in SSOT before implementation.
- Don't infer status from archived design docs.

## Related

- `docs/README.md`
- `docs/QUICK_START.md`
- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/backend-frontend/backend-frontend-alignment.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
- `docs/reference/PRESET_V2_SPEC.md`
- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`
- `docs/playbooks/RESTART_TOMORROW.md`
