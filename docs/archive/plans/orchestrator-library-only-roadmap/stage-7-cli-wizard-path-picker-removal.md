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

## Implementation Notes (Stage 7 Execution)

1. Removed orchestrator CLI/wizard/path-picker source and tests:
   - deleted CLI entrypoint module and associated test coverage.
   - deleted interactive wizard and path-picker modules and associated test coverage.
2. Removed CLI entrypoint from package/build/runtime surfaces:
   - removed `bin` mapping from orchestrator `package.json`.
   - removed CLI bundle entry from `tsup` config.
   - removed CLI postbuild handling and docker runtime CLI command.
3. Updated orchestrator API export surface for library-only usage:
   - removed `loadCliEnv` re-export and `LoadCliEnvOptions` type re-export from orchestrator public API.
4. Updated active docs/SSOT:
   - orchestrator docs now describe library-only contract and backend-only operational entrypoint.
   - ownership/system-review/SSOT references to deprecated CLI surfaces are updated to retired status.
