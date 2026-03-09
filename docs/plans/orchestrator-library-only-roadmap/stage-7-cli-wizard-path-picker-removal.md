# Stage 7: CLI, Wizard, and Path-Picker Removal

## Objective

Remove the orchestrator CLI surface entirely after backend cutover and parity gates are complete.

## Ownership Outcomes (Stage Scope)

1. `Keep`: orchestrator retains library runtime exports only.
2. `Keep`: batch-backend remains the only operational entrypoint.
3. `Extract shared`: none in this stage.
4. `Retire`: CLI command entrypoint, wizard flow, and path-picker UI modules are removed.

## Tasks

1. Remove CLI packaging and entrypoints from orchestrator build/publish config.
2. Remove CLI-only modules and tests:
   - CLI command adapter,
   - interactive wizard support,
   - path-picker UX utilities,
   - CLI-only logger formatting helpers if no longer used.
3. Remove CLI references from docs and usage examples.
4. Preserve library runtime exports and ensure backend integration remains unaffected.
5. Record this as a major-impact stage in release notes and migration docs.

## Dependencies

1. Stage 6 backend cutover and parity complete.
2. No active operational workflow depends on CLI.

## Acceptance Criteria

1. Orchestrator package has no CLI command entrypoint.
2. Library runtime API remains stable for backend consumption.
3. Removed modules have no remaining imports.
4. All required tests/typecheck/docs checks pass post-removal.

## Risks and Rollback

1. Risk: hidden local scripts still invoke removed CLI.
2. Mitigation: pre-removal usage inventory and migration notes.
3. Rollback: restore compatibility shim package or temporary wrapper command outside orchestrator if urgent fallback is needed.
