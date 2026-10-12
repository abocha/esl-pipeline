---
name: esl-pipeline-validation-evidence
description: Use only when changing ESL Pipeline validation or hosted-CI policy/topology, backend test-project classification, service-test infrastructure, validation evidence machinery, or when diagnosing a failure of that validation system itself. Do not use merely to validate an ordinary application or documentation change.
---

# ESL Pipeline validation-system changes

This skill governs the validation system itself, not routine validation of feature work.

Normal evidence selection belongs to the
[testing guide](../../../docs/reference/TESTING_GUIDELINES.md#choose-the-evidence-route);
validation invariants belong to the
[SSOT](../../../docs/reference/agents-ssot.md#runtime-and-verification-baseline).

## Find the changed mechanism

Follow only the applicable row. Retrieve current commands and prerequisites from its owner.

| Mechanism                                                | Implementation owner                                                                                                                                                                                               | Existing evidence to inspect                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosted scope or workspace impact                         | [scope model](../../../scripts/check/workspace-change-scope.mjs), [Git entrypoint](../../../scripts/check/run-ci-scope.mjs); [image projection](../../../scripts/release/production-image-scope.mjs) when affected | [scope cases](../../../scripts/check/workspace-change-scope.test.mjs), [Git entrypoint cases](../../../scripts/check/run-ci-scope.test.mjs), [image cases](../../../scripts/release/production-image-scope.test.mjs)                             |
| Backend prerequisite membership or environment isolation | [project model](../../../packages/batch-backend/vitest.projects.mjs), [setup](../../../packages/batch-backend/tests/setup/project-env.mjs), [pure environment](../../../scripts/test/pure-test-env.mjs)            | [project contracts](../../../scripts/check/backend-test-projects.test.mjs), [pure environment cases](../../../scripts/test/pure-test-env.test.mjs)                                                                                               |
| Local DB/worker helper                                   | [helper](../../../scripts/test/run-backend-db-worker-check.mjs), [backend execution recipe](../../../packages/batch-backend/README.md#validation)                                                                  | [PG environment cases](../../../packages/batch-backend/tests/bootstrap.pg-test-env.test.ts), [service environment cases](../../../packages/batch-backend/tests/support/test-env.test.ts); these do not cover the helper's child-process behavior |
| Hosted job, command or evidence artifact                 | [workflow](../../../.github/workflows/ci.yml), its selected job and retained logs/artifacts                                                                                                                        | [workflow contracts](../../../scripts/check/ci-workflow-structure.test.mjs); [hosted reproduction route](../../../docs/reference/TESTING_GUIDELINES.md#hosted-pr-ci-job-reproduction)                                                            |

## Select evidence for the failure

Identify the plausible failure introduced by the change and the existing case that could expose it.
For example:

- A scope change could skip required evidence for a renamed file, an indirect dependent or unknown
  ownership. Exercise those inputs through the classifier; inspect Git entrypoint or independent
  workflow bootstrap coverage only when that boundary is affected.
- A membership/setup change could omit a test, assign it twice or let a pure test consume ambient
  service credentials. Use project-contract and poisoned-environment cases. A changed PostgreSQL,
  Redis or media interaction needs evidence at that actual boundary.
- A service-helper change could construct the wrong environment, mishandle a child failure or target
  an unsafe database. Inspect the environment cases and database safeguard owner; add focused helper
  coverage for changed behavior they do not exercise. Use a disposable service when the actual
  service interaction is the behavior under test.
- A hosted failure could originate in prerequisites rather than the code under test. Inspect the
  selected job's first relevant failure and retained evidence before reproducing its command.

Do not infer meaningful coverage from a test filename or a passing neighboring suite. Preserve the
SSOT's fail-closed scope, transitive impact, prerequisite membership, pure-environment isolation and
hosted merge requirements; keep local service helpers narrow.

## Reuse and finish

Apply the guide's [evidence applicability and completion rules](../../../docs/reference/TESTING_GUIDELINES.md#evidence-and-merge-boundary)
to existing results before running more checks. Report the changed mechanism, exact evidence and
remaining requirements. Historical commands are lookup clues; verify them against current owners.
