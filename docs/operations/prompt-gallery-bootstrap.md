# Prompt Gallery Bootstrap (DB-Canonical Runtime)

Prompt templates and profiles are now runtime-managed from PostgreSQL revision tables.
Backend startup validates DB prompt catalog readiness and fails if defaults are not active.

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
- Scans configured prompt roots (`PROMPT_TEMPLATE_PATH` and `PROMPT_PROFILE_PATH` parents).
- Classifies files:
  - template: contains exact `INSERT PROFILE HERE` marker line
  - profile: all other `.md`/`.txt` files
- Upserts prompt assets and hash-deduplicated revisions.
- Activates imported revision when an asset has no active revision.
- Verifies configured defaults are present and active.

## Startup failure mode

If backend startup fails with prompt catalog readiness/config errors:

1. Run `prompt-assets:bootstrap:dry` and inspect discovery output.
2. Confirm configured defaults are discovered.
3. Run `prompt-assets:bootstrap`.
4. Restart backend and worker.

## Archive semantics (no hard delete)

Prompt CRUD APIs use archive behavior:

- `DELETE /profiles/:id` clears active revision pointer and deprecates active revision.
- `DELETE /templates/:id` clears active revision pointer and deprecates active revision.

Revision rows are preserved for restore/activate workflows.
