# Prompt Gallery Bootstrap (DB-Canonical Runtime)

## Meta

- Audience: maintainers and AI agents deploying batch-backend environments.
- Authority Level: operations runbook.
- Last Verified Against: 2026-07-27 repo state.
- Owner: backend maintainer + automation agents.
- Review Cadence: monthly or after prompt/runtime model changes.
- Status: `runbook`.

Prompt templates and profiles are now runtime-managed from PostgreSQL revision tables.
Backend startup validates DB prompt catalog readiness and logs warnings when defaults are missing, so services can start while operators run bootstrap.

## Required bootstrap commands

Run these commands after deploying backend code to a new environment:

```bash
pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap:dry
pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap
```

## What bootstrap does

- Loads env with the batch-backend bootstrap loader.
- Requires:
  - `ESL_PIPELINE_CONFIG_PROVIDER=local`
  - `PG_ENABLED=true`
- Scans configured prompt roots (`PROMPT_TEMPLATE_PATH` and `PROMPT_PROFILE_PATH` parents). The
  checked-in defaults live under `packages/batch-backend/prompt-assets/**`, which is copied into the
  same `/app/packages/batch-backend/prompt-assets/**` path in the production image.
- Requires template/profile roots to be distinct and non-overlapping.
- Classifies files by root only:
  - template: files discovered from the configured template root
  - profile: files discovered from the configured profile root
- Upserts prompt assets and hash-deduplicated revisions.
- Activates imported revision when an asset has no active revision.
- Retires active DB templates that are no longer present under the configured template root.
- Verifies configured defaults are present and active.

## Startup warning mode

If backend startup logs prompt catalog readiness/config warnings:

1. Run `prompt-assets:bootstrap:dry` and inspect discovery output.
2. Confirm configured defaults are discovered.
3. Run `prompt-assets:bootstrap`.
4. Restart backend and worker after bootstrap to clear readiness warnings.

## Archive semantics (no hard delete)

Prompt CRUD APIs use archive behavior:

- `DELETE /profiles/:id` clears active revision pointer and deprecates active revision.
- `DELETE /templates/:id` clears active revision pointer and deprecates active revision.

Revision rows are preserved for restore/activate workflows.
