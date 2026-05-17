# Stage 8: Final Cleanup and CI Guardrails

## Objective

Finalize the library-only architecture, remove transitional debt, and enforce boundaries with CI and docs guardrails.

## Ownership Outcomes (Stage Scope)

1. `Keep`: orchestrator = pipeline library owner.
2. `Keep`: batch-backend = runtime execution owner.
3. `Extract shared`: complete any remaining planned shared helper migrations.
4. `Retire`: remove deprecations, compatibility adapters, and dead transitional code.

## Tasks

1. Remove temporary compatibility adapters no longer required after cutover.
2. Finalize docs and SSOT so boundaries are explicit and consistent.
3. Add or tighten CI checks preventing:
   - reintroduction of orchestrator CLI artifacts,
   - boundary drift that moves runtime concerns into orchestrator,
   - unreviewed contract changes without matching docs updates.
4. Run final parity and regression sweep across orchestrator and batch-backend integration lanes.

## Dependencies

1. Stage 7 CLI removal complete.
2. All migration notes and ownership ledger updates complete.

## Acceptance Criteria

1. No transitional compatibility paths remain unless explicitly retained by policy.
2. CI guardrails enforce library-only orchestrator boundary.
3. Docs and SSOT are synchronized with implemented architecture.
4. Final test matrix passes across orchestrator, backend integration, and docs checks.

## Risks and Rollback

1. Risk: aggressive cleanup removes needed fallback code too early.
2. Mitigation: stage completion checklist and final verification sweep before deletion.
3. Rollback: restore narrowly scoped adapters on a hotfix branch while retaining new boundary checks.

## Implementation Notes (Stage 8 Execution)

1. Removed transitional v2 compatibility adapter surface from orchestrator:
   - retired `newAssignmentViaV2`, `rerunAssignmentViaV2`, `getAssignmentStatusViaV2`, `planRerunAssignmentViaV2`.
   - removed legacy-shape adapter helpers from `api-v2.ts`.
2. Removed stale root CLI invocation path (`pnpm esl`) and updated active docs to library-only posture.
3. Added CI guardrail script (`pnpm guard:orchestrator:boundary`) and wired it into:
   - `check:fast`
   - CI static checks workflow
4. Guardrails now enforce:
   - no orchestrator CLI entrypoint/artifact reintroduction,
   - no backend-runtime coupling patterns in orchestrator,
   - docs/SSOT update requirement when contract-sensitive files change.
