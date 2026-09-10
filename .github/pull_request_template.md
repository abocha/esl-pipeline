## Summary

- What changed?
- Why was this needed?

## Validation

- Focused local evidence is the default; record the commands and outcomes that cover this PR's
  plausible failure modes.
- [ ] Focused local evidence recorded (commands and outcomes)
- [ ] Optional local aggregate validation recorded with its concrete diagnostic reason (if run)
- [ ] CI-owned comprehensive evidence identified: selected hosted jobs and `CI gate` remain required
      before merge
- [ ] Risk-specific checks recorded, such as formatting, repository hygiene, DB, migration, worker,
      HTTP, Docker, workflow, or docs checks
- [ ] Manual/environment-owned evidence recorded, or marked not applicable
- [ ] `pnpm release:verify:contracts` and `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline` when migrations/schema/contracts changed
- [ ] Targeted package tests (if applicable)
- [ ] I inspected the aggregate summary before rerunning and used at most one isolated diagnostic rerun per unchanged failure

## Risk Notes

- Runtime/config impacts:
- Backward compatibility concerns:

## Checklist

- [ ] I touched only files relevant to this PR.
- [ ] I updated docs or comments where behavior changed.
- [ ] I did not commit generated local artifacts.
