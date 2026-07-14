# CI Scope and Local Validation Design

## Meta

- Audience: maintainers and implementation agents.
- Status: approved design.
- Last Verified Against: 2026-07-14 repository workflows and representative PR timing evidence.
- Owner: founder-maintainer + automation agents.
- Scope: affected CI lanes, scheduled diagnostics, and local validation policy.

## Problem

Pull-request CI currently starts every blocking integration and smoke job for every change. The
blocking static job also runs the complete build, typecheck, lint, and unit sequence even for
documentation-only changes. Two non-blocking jobs independently rerun substantial portions of the
unit suite to produce coverage and timing reports.

A representative successful run used about 23 runner-minutes and had a six-minute critical path.
The static job spent about 51 seconds building, 43 seconds typechecking, 26 seconds linting, and 193
seconds running unit tests. Coverage and unit-timing diagnostics consumed another 11.5
runner-minutes without affecting merge eligibility.

Local guidance can also be misread as requiring both the affected check and the broad pre-PR check
for every branch. That duplicates work locally and again in hosted CI.

## Goals

1. Select heavyweight hosted CI lanes from repository-owned changed-file logic.
2. Keep unknown or high-risk changes conservative: ambiguity widens validation rather than skipping
   it.
3. Remove coverage and unit-timing duplication from ordinary PR updates while retaining both
   diagnostics on a predictable schedule and on demand.
4. Make local and hosted scope decisions derive from the same pure classifier.
5. Establish `check:fast:agent` as the normal pre-push gate and reserve explicit
   `check:pre-pr` runs for broad, cross-cutting, or diagnostic cases.

## Non-Goals

- Sharding the blocking static or unit-test job.
- Parallelizing production image builds.
- Changing release workflow concurrency.
- Adding remote Turbo caching or caching `node_modules`.
- Weakening, deleting, or rewriting the tests inside a selected lane.
- Replacing pinned GitHub Actions or introducing a third-party path-filter action.

Those first three items remain separately reviewable follow-up work after this slice has produced
real timing evidence.

## Architecture

### Shared Scope Classifier

The existing affected-check module remains the source of truth for changed files, workspace package
relationships, path-risk rules, and conservative fallbacks. It gains a pure CI-scope projection
that accepts normalized changed files plus workspace metadata and returns named booleans with human
readable reasons.

The projection exposes these hosted scopes:

- `runtime`: build, typecheck, lint, and unit work is required.
- `integration`: general package integration tests are required.
- `backend_db_worker`: database, migration, repository, queue, or worker integration is required.
- `telegram`: the Telegram Compose command-loop smoke is required.
- `docs_only`: every changed path is in the explicitly safe documentation set.

The projection also reports the changed paths and reasons in a compact summary. Local dry-run output
shows both the existing local lanes and these hosted scopes so an agent can predict the PR job graph
before pushing.

Classification is fail-conservative:

- An unknown or unclassified path enables every blocking hosted scope.
- Root package-manager, TypeScript, Vitest, Biome, ESLint, Turbo, workflow, and CI-classifier changes
  enable every blocking hosted scope.
- Mixed documentation and runtime changes are runtime changes, never docs-only.
- Generated documentation remains documentation.
- The classifier process itself failing makes the change-scope job fail; downstream skips cannot
  turn a classifier failure into a green PR.

### Pull-Request Workflow

The PR workflow gains a lightweight `change-scope` job. It checks out full history, runs the
dependency-free Node classifier, writes booleans and a summary to job outputs, and prints the scope
decision in the log.

The blocking jobs consume those outputs:

- `static-checks` always runs. Checkout, Node/pnpm setup, installation, environment validation,
  cheap global contract/orchestrator guards, and documentation checks remain available on every PR.
  Build, typecheck, lint, and unit-test steps run only when `runtime` is true.
- Repository hygiene tooling and its workflow/shell/Compose/dependency checks remain in the always-run
  static guard section. They are cheap relative to runtime validation and preserve one predictable
  baseline while the first slice proves its scope rules.
- `integration-tests` runs when `integration` is true.
- `backend-db-integration` runs when `backend_db_worker` is true.
- `telegram-compose-smoke` runs when `telegram` is true.

Skipped jobs are expected and visible. GitHub treats a job skipped by a job-level condition as a
successful check, so the stable job names can remain merge-facing without forcing irrelevant work.

### Diagnostics Workflow

Coverage and unit-timing jobs leave the PR workflow and move to one diagnostics workflow with:

- one weekly schedule against `main` at `17 5 * * 1` (05:17 UTC each Monday, after docs gardening);
- `workflow_dispatch` for an operator-requested run;
- read-only repository permissions;
- the same pinned checkout, pnpm, Node, and artifact actions;
- parallel non-blocking coverage and timing jobs;
- the existing report generation and artifact paths.

Diagnostics failures remain visible in their workflow and artifacts but do not block unrelated PRs.
The first implementation does not merge the two diagnostic test executions because their package
sets and reporter requirements differ.

## Local Validation Policy

The normal local sequence is:

```text
focused tests during implementation -> check:fast:agent before push -> scoped hosted CI
```

Rules:

1. Run focused tests while developing and after each relevant change.
2. Run `pnpm --silent run check:fast:agent` before pushing.
3. Let the affected classifier choose or widen the local lanes. If it falls back to
   `check:pre-pr`, do not run `check:pre-pr` a second time.
4. Run `pnpm check:pre-pr` explicitly only for a deliberately broad or cross-cutting branch, root
   tooling/dependency/build/test changes, shared contract changes, blocking-CI reproduction, or an
   unavailable/ambiguous affected scope.
5. Run `pnpm check` when reproducing full CI or when database, migration, worker, integration, or
   similarly system-wide behavior requires it.

`check:fast:dry-run` must show the local plan and hosted scope projection. This preview is the
supported way to answer “what will run after I push?” without executing the lanes.

The agent handbook and testing guidance must describe this risk-based policy without weakening
package-specific validation requirements.

## Scope Rules

The implementation will encode and test at least these cases:

| Change shape                                                       | Runtime |                           Integration |                             DB/worker | Telegram | Docs-only |
| ------------------------------------------------------------------ | ------: | ------------------------------------: | ------------------------------------: | -------: | --------: |
| Active or archived documentation only                              |      no |                                    no |                                    no |       no |       yes |
| Frontend runtime or frontend tests                                 |     yes |                                   yes |                                    no |       no |        no |
| Backend application or transport code                              |     yes |                                   yes |     conservative by backend predicate |       no |        no |
| Migration, schema baseline, DB repository, queue, or worker        |     yes |                                   yes |                                   yes |       no |        no |
| Telegram package or Telegram smoke surface                         |     yes | yes where package integration applies | no unless shared backend risk applies |      yes |        no |
| Compose, deploy, or shared runtime surface affecting Telegram      |     yes |                                   yes |     conservative by backend predicate |      yes |        no |
| Root toolchain, workflow, classifier, unknown, or mixed risky path |     yes |                                   yes |                                   yes |      yes |        no |

Exact path predicates should reuse current affected-check helpers and dependency expansion rather
than duplicate string lists in workflow YAML.

## Error Handling and Observability

- The change-scope job logs normalized changed paths, selected scopes, and reasons.
- Unknown paths are reported explicitly before widening all scopes.
- A classifier exception fails the job with a reproduction command; it does not silently emit a
  narrow scope.
- Existing test, docs-health, DB/schema, Telegram, coverage, and timing artifacts remain unchanged
  when their producing job runs.
- Agent-mode local checks remain quiet on success and retain detailed artifacts under
  `tmp/check-logs/`.

## Testing

### Classifier Tests

Extend the existing Node test suite with table-driven fixtures for:

- documentation-only changes;
- frontend code and tests;
- ordinary backend code;
- migrations/schema/database repositories;
- queue and worker code;
- Telegram package and Compose/smoke paths;
- mixed docs and runtime changes;
- root toolchain and workflow changes;
- unknown root paths;
- transitive workspace dependencies relevant to Telegram or backend execution.

Tests assert both booleans and reasons. A regression must fail if an unknown path becomes narrow.

### Workflow Tests

- `actionlint` validates both workflow files.
- A script-level fixture verifies GitHub output formatting without requiring an Actions runner.
- The PR workflow is reviewed to ensure every conditional job depends on `change-scope` and uses the
  intended output.
- Diagnostics workflow tests verify the schedule/manual triggers, non-blocking jobs, report commands,
  and artifact paths.

### Repository Validation

Implementation validation includes focused classifier tests, workflow lint, formatting, repository
hygiene, docs checks, affected dry-run examples, `check:fast:agent`, and the broad lane only when the
classifier correctly selects it for the workflow/tooling changes in this branch.

## Acceptance Criteria

1. A docs-only fixture selects no runtime, integration, DB/worker, or Telegram work.
2. Relevant production-code fixtures still select every required blocking lane.
3. Unknown and root/toolchain fixtures select all blocking lanes.
4. PR CI contains no coverage or unit-timing jobs.
5. Weekly and manual diagnostics retain both reports and artifacts.
6. Local dry-run output predicts hosted scopes from the same classifier used by CI.
7. Agent guidance no longer implies that `check:pre-pr` is mandatory before every PR.
8. No selected lane has reduced test content or weaker failure behavior.

## Follow-Up Gate

After enough PRs have run through the scoped workflow, review job duration and skip-rate evidence.
Only then plan:

1. static/build/typecheck/lint separation and unit-test sharding;
2. release concurrency reconciliation;
3. parallel production image publication.

These follow-ups require their own design or an explicit extension of this design before
implementation.
