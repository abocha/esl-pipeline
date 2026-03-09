# CLI Removal Release and Migration Note Template

Use this template when Stage 7 removes orchestrator CLI/wizard/path-picker surfaces.

## Release Notes Template

### Breaking Change: Orchestrator CLI Removed

- Removed CLI entrypoints from `@esl-pipeline/orchestrator`:
  - `esl` command
  - interactive wizard flow
  - `esl select` path-picker command
- `@esl-pipeline/batch-backend` is now the only supported operational runtime entrypoint.
- Orchestrator remains supported as a programmatic library API.

### Why This Changed

- Ownership model: orchestrator owns canonical pipeline semantics; batch-backend owns runtime operations.
- CLI had no active operational role and created maintenance drag/duplicate operator paths.

## Migration Notes Template

### Who Is Affected

- Teams invoking `pnpm esl ...` or `npx @esl-pipeline/orchestrator esl ...`.
- Scripts that rely on wizard defaults (`wizard.defaults.json`) or path-picker flows.

### Required Actions

1. Replace CLI automation with backend API/worker flows.
2. Route operational runs through batch-backend entrypoints.
3. Remove local script dependencies on:
   - `esl`
   - `esl rerun`
   - `esl status`
   - `esl select`
4. If programmatic pipeline execution is needed, call orchestrator library APIs directly.

### Compatibility Window

- Stage 2-6: deprecation mode, compatibility retained.
- Stage 7: removal (major-impact stage).

### Validation Checklist

1. `pnpm check:fast`
2. `pnpm docs:check`
3. Batch-backend integration tests covering orchestrator API calls pass.
4. No CI jobs or runbooks reference orchestrator CLI commands.
