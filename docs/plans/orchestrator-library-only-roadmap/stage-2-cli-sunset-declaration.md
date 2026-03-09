# Stage 2: CLI Sunset Declaration

## Objective

Formally de-prioritize CLI as an operational path and establish a controlled deprecation runway before removal.

## Ownership Outcomes (Stage Scope)

1. `Keep`: orchestrator runtime APIs remain the canonical integration surface.
2. `Keep`: batch-backend remains the operational entrypoint.
3. `Extract shared`: no extraction in this stage; helper extraction remains queued for Stage 3.
4. `Retire`: CLI/wizard/path-picker are marked deprecated in docs and operational guidance.

## Tasks

1. Update package and repo docs to state backend-first operations and CLI deprecation status.
2. Remove CLI from recommended runbooks, quick-start paths, and operator instructions.
3. Keep CLI code intact in this stage, but freeze feature work and bugfix scope to critical safety only.
4. Add a release-note and migration note template for eventual CLI removal stage.

## Dependencies

1. Stage 1 baseline and ownership lock must be complete.
2. Documentation routing must already include ownership references.

## Acceptance Criteria

1. No active docs present CLI as the primary or required operational path.
2. Teams can execute current workflows via backend surfaces without CLI dependency.
3. CLI deprecation intent is explicit in roadmap docs and future release notes templates.

## Risks and Rollback

1. Risk: hidden scripts still rely on CLI entrypoint.
2. Mitigation: inventory internal scripts/workflows before Stage 7 removal.
3. Rollback: retain deprecation-only posture and postpone removal until dependencies are migrated.

## Implementation Notes (Stage 2 Execution)

1. Backend-first operational guidance is now explicit in active docs (`README.md`, `docs/QUICK_START.md`, `AGENTS.md`, and SSOT sections for orchestrator ownership/API priority).
2. CLI remains in code but is documented as deprecated compatibility only; new feature work is explicitly disallowed in SSOT deprecation-mode rules.
3. Release/migration template for eventual CLI removal added:
   - `docs/plans/orchestrator-library-only-roadmap/cli-removal-release-and-migration-note-template.md`
