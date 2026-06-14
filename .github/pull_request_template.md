## Summary

- What changed?
- Why was this needed?

## Validation

- [ ] `pnpm format`
- [ ] `pnpm run lint:repo-hygiene`
- [ ] `pnpm check:fast` or `pnpm --silent run check:fast:agent` (affected validation)
- [ ] Risk-specific lanes, such as DB, migration, worker, HTTP, Docker, workflow, or docs checks
- [ ] `pnpm check:pre-pr` when the change is broad or cross-cutting
- [ ] `pnpm release:verify:contracts` and `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline` when migrations/schema/contracts changed
- [ ] Targeted package tests (if applicable)
- [ ] Manual smoke test (if applicable)

## Risk Notes

- Runtime/config impacts:
- Backward compatibility concerns:

## Checklist

- [ ] I touched only files relevant to this PR.
- [ ] I updated docs or comments where behavior changed.
- [ ] I did not commit generated local artifacts.
