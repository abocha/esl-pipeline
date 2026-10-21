# Script failure evidence corrections

## Meta

- Status: active
- Last Verified Against: 2026-10-22 implementation branch from clean `main` at `becb4012ee1a6d170d8cd74ddcb4990d65f7aaa5` and approved ESL-68–77 descriptions.
- Exit Trigger: archive after implementation merges; local delivery alone does not close execution issues.
- Current Focus: all three batches implemented and reviewed locally; hosted validation and merge remain pending.

## Scope and order

1. ESL-68 export privacy; ESL-69 backup evidence publication and invocation-owned drill cleanup;
   ESL-70 required postbuild configuration; ESL-71 fixed Compose cleanup project.
2. ESL-72 confirmed bootstrap/replay progress; ESL-73 S3 cleanup residue; ESL-74 incomplete
   listening attempts; ESL-75 Telegram transport failure reports.
3. ESL-76 partial/unavailable coverage heading; ESL-77 supported replay provider guidance.

The complete Linear execution descriptions are the approved acceptance contracts. Research
ABO-61–66 retains the source maps and KEEP/DEFER decisions. Preserve successful output contracts,
runtime/durable identity and admission, existing report schemas except explicitly approved attempt
evidence, and the excluded deployment operator-output work. No new dependencies, retries or broad redesign.

## Ownership and evidence

The primary owns integration, this plan, issue updates and local delivery. Batch 1 uses separate
owners for export, coupled backup EXIT/cleanup paths, and mechanical postbuild/dev script fixes.
Later backend replay work stays coordinated with its runbook. Workers preserve concurrent edits
and own their focused inspect/edit/test loops; shared manifests have explicit ownership.

Use synthetic artifacts, fake transports/Docker/AWS and temporary filesystem faults to exercise
the specified failures and representative success/caller regressions. Review concrete residual
privacy, cleanup and retry risks independently when justified. Record actual commands/results
below at local completion. Hosted CI, publication and production verification remain separate.

## Authorization boundary

Local changes, tests, commits and Linear evidence updates are authorized. Subsequent PR submission
authorization covers branch push and PR publication. Merge, deployment, live VPS/data/restore/replay/
provider operations, notifications and automations remain outside scope.

## Delivery evidence

All evidence below is local and synthetic. No hosted CI, provider, real service or production
verification is claimed. Execution issues remain In Progress until repository delivery lifecycle
permits closure. Research owners retain their KEEP/DEFER guidance.

| Issues | Result                                                                                                                                                               | Focused evidence                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ESL-68 | Export failure omits learner contents and identifies retained private staging/output.                                                                                | Backend export CLI/parser/renderer: 3 files, 8 tests.                                                       |
| ESL-69 | Report publication failures propagate; prior latest survives; failed-start cleanup checks invocation ownership and preserves primary failure.                        | Fake Docker/AWS/filesystem faults and existing ops contracts: 25 tests; Bash syntax and focused ShellCheck. |
| ESL-70 | Required config copy rejects postbuild; sourcemap cleanup remains best effort.                                                                                       | Isolated postbuild fixtures: 2 tests.                                                                       |
| ESL-71 | Alias fixes the Compose project; standalone overrides and dependency allowlist remain.                                                                               | Fake Docker targeting/list/remove cases: 5 tests.                                                           |
| ESL-72 | Failure summaries give confirmed progress, uncertain failing effects and same-intent/async recovery guidance.                                                        | Backend synthetic CLI and bootstrap contracts: 3 files, 24 tests.                                           |
| ESL-73 | Cleanup residue uses full uploaded key; original error survives; cleanup-only failure rejects with safe diagnostics.                                                 | Fake smoke/adapter SDK rejection and redaction: 6 tests.                                                    |
| ESL-74 | Failed/incomplete attempt evidence and report cards distinguish absence; successful result records remain compatible.                                                | Fake provider/media and temporary JSON publication faults: 7 tests.                                         |
| ESL-75 | Transport/abort/read failure writes failed version-1 report; authentication payload and transport-failure trace bodies omitted; persistence failure remains nonzero. | New fake transport/CLI tests: 8; existing rollout script tests: 9.                                          |
| ESL-76 | Markdown shows PARTIAL or UNAVAILABLE and exact available/configured count near title.                                                                               | Complete/partial/absent synthetic summaries and existing scope note: 4 tests.                               |
| ESL-77 | Ordinary replay provider guidance matches OpenAI-only parser admission.                                                                                              | Compared all three parser guards; focused Markdown formatting.                                              |

Exact behavioral commands executed by the primary or owning worker:

```powershell
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config vitest.config.ts --project pure tests/tools.export-student-lesson-artifacts.test.ts tests/tools.export-student-lesson-artifacts.execution.test.ts tests/application.student-lesson-artifact-export.test.ts
node --test scripts/docker/postgres-ops-evidence.test.mjs scripts/docker/postgres-ops-scripts.test.mjs
pnpm --filter @esl-pipeline/orchestrator exec vitest run --config ../../vitest.config.ts tests/postbuild.test.ts
node --test scripts/docker/clean-dev-dependency-volumes.test.mjs
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config vitest.config.ts --project pure tests/tools.memory-maintenance-progress.test.ts tests/tools.bootstrap-prompt-assets.test.ts tests/application.template-control-plane.test.ts
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config vitest.config.ts --project pure tests/tools.smoke-s3-storage.test.ts
node --test scripts/tts-listening-trial/attempts.test.mjs
node --test scripts/release/telegram-ops-go-live-verify.test.mjs
pnpm --filter @esl-pipeline/telegram-ops-bot exec vitest run --config ../../vitest.config.ts tests/go-live-rollout-scripts.test.ts
node --test scripts/test/generate-coverage-report.test.mjs
pnpm --filter @esl-pipeline/batch-backend typecheck
bash -n scripts/docker/run-postgres-artifact-integrity-check.sh scripts/docker/run-postgres-restore-drill.sh
bash -lc 'shellcheck scripts/docker/run-postgres-artifact-integrity-check.sh scripts/docker/run-postgres-restore-drill.sh scripts/docker/postgres-ops-common.sh'
```

Changed-file Biome and Markdown Prettier checks passed (the existing bootstrap `isWithinRoot`
unused warning remains). Independent exceptional-risk review found no actionable issues in
export privacy, backup EXIT/cleanup, replay/bootstrap semantics and S3 cleanup/redaction.
Independent reporting review found one late-transport trace privacy gap; the fix and sentinel regression were reviewed and resolved. No remaining actionable findings. Final committed documentation check results and commit location are recorded on ESL-68–77 and ABO-61–66.

Residual limits: failed requests can have unconfirmed effects; confirmed replay requests do not
prove worker completion. Filesystem failure can prevent attempt evidence persistence and remains
an explicit nonzero error. Real platform/provider/manual behavior and hosted merge requirements
remain separate from these local checks.
