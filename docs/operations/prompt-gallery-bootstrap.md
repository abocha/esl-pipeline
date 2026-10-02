# Prompt Gallery Bootstrap (DB-Canonical Runtime)

## Meta

- Audience: maintainers and AI agents deploying batch-backend environments.
- Authority Level: operations runbook.
- Last Verified Against: 2026-10-01 ABO-12 cutover.
- Owner: backend maintainer + automation agents.
- Review Cadence: monthly or after prompt/runtime model changes.
- Status: `runbook`.

Prompt templates are runtime-managed from PostgreSQL revisions. Foundational learner profiles belong
to students and are created through student onboarding or Learning, never a bootstrap catalog.
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
- Scans only the parent of `PROMPT_TEMPLATE_PATH`. Checked-in templates live under
  `packages/batch-backend/prompt-assets/templates`, copied into the same `/app` path in the image.
- `PROMPT_PROFILE_PATH` and standalone profile imports are retired by API contract 6 / DB contract 1.
- Upserts prompt assets and hash-deduplicated revisions.
- Activates an imported revision only when an asset has no active revision. Changed checked-in
  content for an already-active asset is imported as a draft and requires explicit admin activation.
- Retires active DB templates that are no longer present under the configured template root.
- Verifies configured defaults are present and active.

For an existing environment receiving a changed default template, run the dry/apply commands, review
the imported draft through the service-owned template management surface, and explicitly activate
the intended revision. Bootstrap does not replace an existing active revision automatically.
For a single deployed template whose shipped hash has not been imported, an admin can instead use
**Import & activate** in Administration > Prompts. This imports the current running asset and
explicitly activates it, preserving previous revisions. If activation fails after import, refresh
the persisted state and use **Activate shipped** to retry; the imported revision remains in history.

## Startup warning mode

If backend startup logs prompt catalog readiness/config warnings:

1. Run `prompt-assets:bootstrap:dry` and inspect discovery output.
2. Confirm configured defaults are discovered.
3. Run `prompt-assets:bootstrap`.
4. Restart backend and worker after bootstrap to clear readiness warnings.

## Archive semantics (no hard delete)

Prompt CRUD APIs use archive behavior:

- `DELETE /templates/:id` clears active revision pointer and deprecates active revision.

Revision rows are preserved for restore/activate workflows.
