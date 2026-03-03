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
docker compose up -d
```

Then open `http://localhost:5173`.

## Do / Don't

- Do load required env values before running backend/pipeline flows.
- Do use package-filtered commands for targeted validation.
- Don't assume optional services (Deepgram, S3, Notion) are available in local tests.

## Related

- `docs/reference/env.md`
- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/backend-frontend/backend-frontend-alignment.md`
