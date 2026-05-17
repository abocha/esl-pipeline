# Stage 4: Orchestrator Core Modularization

## Objective

Restructure orchestrator internals into cohesive runtime modules while preserving externally visible behavior.

## Ownership Outcomes (Stage Scope)

1. `Keep`: canonical pipeline stages + manifest semantics remain in orchestrator core.
2. `Keep`: batch-backend runtime concerns remain external.
3. `Extract shared`: only already-designated shared helpers are extracted; no new boundary expansion by default.
4. `Retire`: internal dead paths or duplicate glue logic are removed when fully covered by tests.

## Tasks

1. Split monolithic runtime logic into explicit modules:
   - stage reporting,
   - publish target helpers,
   - artifact lifecycle,
   - telemetry/error classification,
   - policy/config resolution seams.
2. Preserve public exports and wire compatibility adapters where internal signatures change.
3. Keep CLI untouched except for import fallout needed to keep build green.
4. Add focused unit tests per new module and retain end-to-end integration checks.

## Dependencies

1. Stage 3 extraction complete for designated shared helpers.
2. Stable characterization suite from Stage 1.

## Acceptance Criteria

1. Internal modules are smaller and responsibility-focused.
2. Public behavior remains equivalent to baseline characterization expectations.
3. Orchestrator test lanes (unit, integration, typecheck) pass without reduced coverage.

## Risks and Rollback

1. Risk: internal refactor accidentally shifts stage sequencing or manifest mutation order.
2. Mitigation: stage/order and manifest parity tests remain mandatory gate checks.
3. Rollback: revert module boundary changes in targeted slices, not full package rollback.

## Implementation Notes (Stage 4 Execution)

1. Extracted policy/config resolution seam:
   - `packages/orchestrator/src/runtime/voice-preferences.ts`
   - moved voice/accent token resolution and catalog caching out of `index.ts`.
2. Extracted publish-target helper seam for Anytype:
   - `packages/orchestrator/src/runtime/publish-target-anytype.ts`
   - moved object-id parsing, space resolution, and collection attach behavior out of `index.ts`.
3. Extracted markdown artifact lifecycle cache seam:
   - `packages/orchestrator/src/runtime/markdown-cache.ts`
   - moved markdown read/cache behavior out of `index.ts`.
4. Added focused runtime module tests:
   - `packages/orchestrator/tests/runtime.voice-preferences.test.ts`
   - `packages/orchestrator/tests/runtime.publish-target-anytype.test.ts`
   - `packages/orchestrator/tests/runtime.markdown-cache.test.ts`
