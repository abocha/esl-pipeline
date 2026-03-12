# Wave 2 - Maintainability

## Goal

Reduce maintenance drag and refactor risk by improving test typing rigor and breaking up large transport routing code into domain modules.

Success is:

1. Cast-heavy backend tests are reduced in high-traffic suites.
2. Route code is modularized with unchanged HTTP behavior.
3. Refactors in transport/app layers can be done without editing a multi-thousand-line route file.

## Included Items

1. `B6` - Reduce `as any` test typing debt in batch-backend.
2. `B1` - Split `extended-routes.ts` into route modules.

Out of scope:

1. Runtime schema evolution/migration unification (`B2`).
2. New product features or route contract changes.

## Implementation Steps

1. Identify top cast-heavy test files in `packages/batch-backend/tests` and define typed mock helpers for Redis, DB, and transport request/response surfaces.
2. Replace repeated inline casts with shared helpers, prioritizing middleware, transport, and job-action tests.
3. Ensure helpers preserve strict assignability to production interfaces to prevent future TS2345 drift.
4. Define route module boundaries that match the actual extended API surface: `config`, `students`, `profiles/templates`, `recordings`, `auth/user`, `ops`, plus a shared registration utility.
5. Extract handlers incrementally into domain route modules while preserving existing route paths, auth behavior, and response shapes.
6. Keep a thin composition entrypoint that mounts all domain route modules in deterministic order.
7. Add/update transport integration tests to confirm route behavior remains unchanged across extraction.
8. Update docs or developer notes that reference transport route ownership/layout.

## Risks and Rollback

1. Risk: module extraction accidentally changes middleware order.
   Rollback: keep original route registration path behind a temporary switch until parity tests are green.
2. Risk: typed mocks become too strict and slow test authoring.
   Rollback: provide minimal helper overloads while keeping assignability guarantees.

## Acceptance Checklist

1. No new `as any` in touched backend tests unless justified with comment.
2. Typecheck passes for `packages/batch-backend` after helper rollout.
3. Route-level integration tests pass with unchanged endpoint behavior.
4. `pnpm --filter @esl-pipeline/batch-backend typecheck`, `pnpm --filter @esl-pipeline/batch-backend test`, and `pnpm --filter @esl-pipeline/batch-backend test:integration:http` pass.
5. `pnpm check:fast` passes before merge.
