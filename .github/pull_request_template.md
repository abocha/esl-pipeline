## Summary

- What changed?
- Why was this needed?

## Validation

- [ ] `pnpm format`
- [ ] `pnpm run lint:repo-hygiene`
- [ ] `pnpm check:fast`
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
