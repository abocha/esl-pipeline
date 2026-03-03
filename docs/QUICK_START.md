# Quick Start (Agent Ops)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 4 minutes.
- Authority Level: Operational quickstart.
- Last Verified Against: 2026-02-06 repo state.

## Purpose

- Provide minimal command path to install, validate, and run core workflows.

## When To Read

- First local run.
- Before smoke-checking a docs/code change.

## Canonical Sources

1. `AGENTS.md`
2. `docs/reference/agents-ssot.md`
3. `docs/reference/env.md`

## Current State

- Node `24.11.1+`, pnpm, and system ffmpeg are required.
- Root test command runs package tests recursively.

## Setup

```bash
corepack enable
pnpm install
```

## Repo Checks

```bash
pnpm -r build
pnpm lint
pnpm test
```

## Orchestrator CLI

```bash
pnpm esl --interactive
pnpm esl --md ./lessons/mission.md --preset b1-default --with-tts --upload s3
pnpm esl status --md ./lessons/mission.md
```

## Batch System (Optional)

```bash
pnpm docker:up
```

Then open `http://localhost:5173`.

If host port `8080` is unavailable in Docker Desktop:

```bash
BATCH_BACKEND_HOST_PORT=8081 pnpm docker:up
```

Common cause: another app (for example qBittorrent Web UI) is already using `8080`.
Close that app or keep using the backend host-port override.

Optional: create and archive a Postgres backup set to S3:

```bash
pnpm docker:db:backup:s3 -- quickstart_checkpoint
```

Requires backup env vars (`PG_BACKUP_S3_BUCKET`, `PG_BACKUP_S3_REGION`, and
`PG_BACKUP_S3_KMS_KEY_ID` when using `PG_BACKUP_S3_SSE=aws:kms`).
Full ops guide: `docs/operations/postgres-backup-s3.md`.

## Do / Don't

- Do load required env values before running backend/pipeline flows.
- Do use package-filtered commands for targeted validation.
- Don't assume optional services (Deepgram, S3, Notion) are available in local tests.

## Related

- `docs/reference/env.md`
- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/backend-frontend/backend-frontend-alignment.md`
