# CI Scope and Local Validation Design

## Meta

- Audience: maintainers and implementation agents.
- Status: approved design.
- Last Verified Against: 2026-07-15 repository workflows, representative PR timing evidence, and
  external design review.
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

The existing affected-check module remains the source of truth for workspace package relationships,
path-risk rules, and conservative fallbacks. It gains a pure CI-scope projection that accepts
normalized changed-file records plus workspace metadata and returns named booleans with structured
reason codes. A formatter turns those codes into human-readable logs without making prose part of
the test contract.

The projection exposes these hosted scopes:

- `runtime`: build, typecheck, lint, and unit work is required.
- `integration`: general package integration tests are required.
- `backend_db_worker`: database, migration, repository, queue, or worker integration is required.
- `telegram`: the Telegram Compose command-loop smoke is required.
- `docs_only`: every changed path is in the explicitly safe documentation set.

Each changed-file record preserves its status and paths. Collection includes added, copied, deleted,
modified, renamed, type-changed, unmerged, and broken-pair entries. Rename and copy records
contribute both old and new paths. Committed Git diffs use null-delimited name-status parsing so
spaces and platform separators cannot corrupt the result.

The projection reports changed paths and structured reasons in a compact summary. Reasons use stable
codes such as `affected-package`, `unknown-path`, `root-toolchain`, and `transitive-consumer`, plus a
scope and subject. Tests assert those fields rather than complete formatted sentences.

Classification is fail-conservative:

- An unknown or unclassified path enables every blocking hosted scope.
- An empty hosted PR diff is an error and cannot become docs-only.
- Root package-manager, TypeScript, Vitest, Biome, ESLint, Turbo, workflow, and CI-classifier changes
  enable every blocking hosted scope.
- Mixed documentation and runtime changes are runtime changes, never docs-only.
- Generated documentation remains documentation.
- The classifier process itself failing makes the change-scope job fail; downstream skips cannot
  turn a classifier failure into a green PR.

### Classifier Bootstrap Boundary

The PR classifier cannot be solely responsible for deciding whether changes to itself are risky.
The workflow therefore contains a deliberately small bootstrap trust boundary independent of the
projection implementation. Before consuming classifier output, it checks changed paths for:

- `.github/workflows/**`;
- `scripts/check/**`;
- `.nvmrc`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `turbo.json`;
- root TypeScript, Vitest, Biome, and ESLint configuration.

Any bootstrap match forces all blocking scopes true after the projection is evaluated. This is an
intentional duplication of the minimum trust-boundary list, not a second general path classifier.
It makes the first rollout possible even though `main` does not yet contain the projection API and
protects against accidental future narrowing of classifier changes.

### Pull-Request Workflow

The PR workflow gains a lightweight `change-scope` job. It checks out full history, runs the
dependency-free Node classifier, writes machine booleans to job outputs, and prints the scope
decision in the log and step summary.

GitHub job outputs are strings. Workflow conditions must use either
`fromJSON(needs.change-scope.outputs.<scope>)` or an explicit `== 'true'` comparison. A bare output
expression is forbidden. Only machine booleans and, if needed, compact single-line JSON go to
`GITHUB_OUTPUT`; readable explanation goes to `GITHUB_STEP_SUMMARY`, the job log, or an artifact.

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

### Aggregate CI Gate

A final `ci-gate` job is the canonical merge-facing result. It uses `if: ${{ !cancelled() }}` and
depends on `change-scope`, `static-checks`, `integration-tests`, `backend-db-integration`, and
`telegram-compose-smoke`. Its evaluator receives every job result plus the scope booleans and fails
unless:

- `change-scope` succeeded;
- `static-checks` succeeded;
- each selected conditional lane succeeded;
- each skipped conditional lane has a corresponding false scope.

A classifier failure therefore produces a failed gate even though downstream conditional jobs are
skipped. Unexpected cancellation or a skipped selected lane also fails the gate.

This private repository cannot currently enforce branch-protection required checks under its GitHub
plan. `CI gate` is still the canonical aggregate status for human merge decisions and becomes the
single required CI check if branch protection becomes available. Documentation must list the gate
and all four underlying blocking lanes, including Telegram.

### Diagnostics Workflow

Coverage and unit-timing jobs leave the PR workflow and move to one diagnostics workflow with:

- one weekly schedule against `main` at `17 5 * * 1` (05:17 UTC each Monday, after docs gardening);
- `workflow_dispatch` for an operator-requested run;
- read-only repository permissions;
- the same pinned checkout, pnpm, Node, and artifact actions;
- parallel coverage and timing jobs that are unrelated to PR merge eligibility;
- the existing report generation and artifact paths.

Diagnostics are not merge-facing, but their own workflow must fail honestly. Each producer command
records its outcome; report generation and artifact upload run with `if: always()`; a final step exits
non-zero when the producer failed. Neither the job nor producer step uses `continue-on-error`. The
first implementation does not merge the two diagnostic test executions because their package sets
and reporter requirements differ.

## Local Validation Policy

The normal local sequence is:

```text
focused tests during implementation -> check:fast:agent before push -> scoped hosted CI
```

Choose one normal pre-push gate:

1. Run focused tests while developing and after each relevant change.
2. Use `pnpm --silent run check:fast:agent` by default.
3. Use `pnpm check:pre-pr` directly when the branch is already known to be broad, cross-cutting,
   shared-contract, or toolchain-level. If `check:fast:agent` falls back to `check:pre-pr`, that
   satisfies the broad gate; do not repeat it.
4. If `pnpm check` is required for full CI reproduction or database, migration, worker, integration,
   or similarly system-wide behavior and succeeds, it subsumes both narrower gates.
5. Clearly docs-only work may use the more specific documented formatting, index, and docs lanes
   instead of `check:fast:agent`, preserving the existing SSOT exception.

`check:fast:dry-run` displays two projections:

- local validation scope from committed, staged, unstaged, and untracked paths;
- hosted CI preview from committed `merge-base...HEAD` paths only.

When the local set contains additional paths, the preview reports how many uncommitted paths are
excluded from hosted scope. Both projections use the same pure classifier. This is the supported
way to answer both “what should I validate locally?” and “what will run after I push?” without
conflating the working tree with the pushed branch.

The agent handbook and testing guidance must describe this risk-based policy without weakening
package-specific validation requirements.

## Scope Rules

The implementation will encode and test at least these cases:

| Change shape                                                       | Runtime |                           Integration |                             DB/worker |                                  Telegram | Docs-only |
| ------------------------------------------------------------------ | ------: | ------------------------------------: | ------------------------------------: | ----------------------------------------: | --------: |
| Active or archived documentation only                              |      no |                                    no |                                    no |                                        no |       yes |
| Frontend runtime or frontend tests                                 |     yes |                                   yes |                                    no |                                        no |        no |
| Backend application or transport code                              |     yes |                                   yes |     conservative by backend predicate |                                        no |        no |
| Migration, schema baseline, DB repository, queue, or worker        |     yes |                                   yes |                                   yes |                                        no |        no |
| Telegram package or Telegram smoke surface                         |     yes | yes where package integration applies | no unless shared backend risk applies |                                       yes |        no |
| Compose, deploy, or shared runtime surface affecting Telegram      |     yes |                                   yes |     conservative by backend predicate |                                       yes |        no |
| `@esl-pipeline/contracts`                                          |     yes |                                   yes |                                   yes |                                       yes |        no |
| `@esl-pipeline/shared-infrastructure`                              |     yes |                                   yes |                                   yes |                                       yes |        no |
| Backend DB test, fixture, bootstrap, or shared test-support path   |     yes |                                   yes |                                   yes | no unless also consumed by Telegram smoke |        no |
| Root toolchain, workflow, classifier, unknown, or mixed risky path |     yes |                                   yes |                                   yes |                                       yes |        no |

Exact path predicates reuse and extend current affected-check helpers and dependency expansion. The
DB/worker scope covers every production path, integration test, fixture, and shared test-support path
whose behavior is primarily validated by `test:db:migrations`, `test:db:postgres`, or
`test:integration:worker`; the narrower current filename helpers are not sufficient by themselves.
Reverse dependency expansion must make contracts and shared-infrastructure changes select both
backend DB/worker and Telegram scopes.

## Error Handling and Observability

- The change-scope job logs normalized changed paths, selected scopes, and reasons.
- It writes readable output to `GITHUB_STEP_SUMMARY` and only machine-safe values to
  `GITHUB_OUTPUT`.
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
- deleted backend source and deleted migrations;
- runtime-to-docs and docs-to-runtime renames, considering both paths;
- frontend code and tests;
- ordinary backend code;
- migrations/schema/database repositories;
- queue and worker code;
- Telegram package and Compose/smoke paths;
- mixed docs and runtime changes;
- root toolchain and workflow changes;
- unknown root paths;
- transitive workspace dependencies relevant to Telegram or backend execution.

Tests assert booleans and structured reason codes. They also enforce these invariants:

- monotonicity: adding a changed path may widen scopes but cannot narrow them;
- exclusivity: `docs_only: true` implies every blocking scope is false;
- unknown safety: an unknown path enables every blocking scope;
- empty safety: an empty hosted diff errors or enables every blocking scope;
- normalization: order, duplicates, `./` prefixes, and Windows separators do not change results;
- rename safety: old and new paths both participate in classification.

### Workflow Tests

- `actionlint` validates both workflow files.
- A script-level fixture verifies GitHub output formatting without requiring an Actions runner.
- A structural workflow test asserts every conditional job depends on `change-scope`, uses explicit
  Boolean conversion, and is included in `ci-gate`.
- The same structural test asserts the independent bootstrap list forces all scopes for workflow,
  classifier, and root-toolchain changes.
- Gate tests cover classifier failure, always-run failure, selected-lane failure, legitimate skips,
  and an unexpectedly skipped selected lane.
- Diagnostics workflow tests verify schedule/manual triggers, honest producer failure, report
  commands, and artifact preservation.

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
9. `CI gate` fails for classifier failure, always-run failure, selected-lane failure, or an
   unexpected skip; it accepts a skipped conditional lane only when its scope is false.
10. Deleted and renamed paths cannot evade their original or destination scope.
11. Scheduled diagnostic producer failures make the diagnostics workflow fail after artifacts are
    preserved.
12. Local dry-run distinguishes working-tree validation scope from committed hosted-preview scope.
13. Workflow, classifier, and root-toolchain fixtures widen all scopes through the independent
    bootstrap boundary even if the projection reports a narrower result.

## Follow-Up Gate

After enough PRs have run through the scoped workflow, review job duration and skip-rate evidence.
Only then plan:

1. static/build/typecheck/lint separation and unit-test sharding;
2. release concurrency reconciliation;
3. parallel production image publication.

These follow-ups require their own design or an explicit extension of this design before
implementation.
