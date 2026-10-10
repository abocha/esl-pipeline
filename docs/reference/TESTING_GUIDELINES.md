# Testing Guidelines (Repo-Wide)

## Meta

- Audience: maintainers and AI agents.
- Authority Level: active test methodology guide.
- Last Verified Against: 2026-09-30 repo state.
- Owner: founder-maintainer + automation agents.
- Status: `active`.

## Purpose

Use the smallest reliable local evidence for the change in progress. Hosted PR CI is the
comprehensive merge gate. Local commands do not emulate the hosted gate and are not a substitute
for a successful `CI gate`.

Hosted CI selects evidence by changed risk surface using deterministic ownership rules in
`scripts/check/workspace-change-scope.mjs`. The workspace graph and transitive dependents drive
ordinary build/unit impact. Those two hosted jobs currently execute workspace-wide; package impact
does not automatically select specialized evidence:

- deterministic integration: HTTP/API transport boundaries, pipeline/provider packages and their
  owned support/tests;
- backend DB/worker: migrations, PostgreSQL repositories/infrastructure, queues/workers, durable
  execution entrypoints and service-project tests/support;
- media: recording preparation, audio/STT processing and owned tests/support, in a separate FFmpeg job;
- Telegram: the bot package, its transitive workspace dependencies, Compose and Telegram smoke inputs.

Repository policy always runs, including tooling tests and docs checks. `docs/**`, `scripts/docs/**`,
`AGENTS.md` and `.codex/**` are docs/tooling scope. Explicit maintenance scope additionally covers
`.gitignore`, `.agents/skills/**`, `scripts/git/**` and the release-label and production-image scope
modules/tests. These paths alone skip application lanes and production packaging. `.dockerignore`
is a known packaging input: it selects production images, but no application evidence lanes.
Do not extend that allowlist to arbitrary
maintenance-looking paths. Unknown paths or untrusted workspace ownership select all application lanes.
Classifier (`scripts/check/**`), workflow and root toolchain changes retain an independent bootstrap
`force_all` safeguard: a routing PR itself receives broad hosted evidence. Each selected lane has
path/rule reasons in the CI summary. Production packaging remains an independent projection.

If hosted CI fails, inspect that job's logs and retained manifest, then reproduce the job's actual
command, configuration, and prerequisites. Do not replace a failing hosted job with a repository-wide
local approximation.

The conditional `production backend packaging` job executes the same backend Dockerfile, Buildx
action, target platform, and fresh-base behavior as the release image build, without pushing an image.
It does not import or export a BuildKit cache. PR workflows can restore accessible caches from the
base and default branches, but PR-created caches are scoped to the PR merge ref and are not
automatically readable by base/default-branch or other PR workflows. The prior PR exporter used a
separate `pr-batch-backend` scope; with that exporter removed, this job no longer imports that
orphaned scope. The release workflow uses a separate scope, so its cache is not an input to this job.
Release builds retain their max-mode export. Their `pull_request_target` trigger has read-only access
to the default-branch cache by default; `ignore-error=true` lets image publication succeed when that
export fails. Shared image inputs and workspace changes that affect the backend select the job;
unrelated PRs skip it. `CI gate` requires the job to succeed whenever selected.

Historical PR job observations took 166s, 195s, 198s, and 157s, with respective max-mode cache
exports of 21s, 24s, 72s, and 22s. Subtracting only each run's own export time gives counterfactual
durations of about 145s, 171s, 126s, and 135s without export. These are not measured no-cache
durations: removing cache imports can also require rebuilding the build-stage toolchain and rerunning
`pnpm fetch`, while the persisted fetched pnpm artifacts keep deployment offline. BuildKit logs marked
`pnpm fetch` as `CACHED`, but restoring that layer still took 25–29s; a cache miss would execute the
command and incur its own work. Consequently, exporter-only subtraction overstates likely net savings.
With nearest-minute job billing, the exporter-only estimates cross a minute boundary for the 195s
and 198s observations (4 to 3 minutes), but not for 166s or 157s (3 to 3 minutes). Rebuild work can
erase those estimated minute savings. Compare successive changed-source PR runs, not only identical-
SHA reruns, before concluding that removing PR cache exports reduced billed minutes.

## Local feedback ladder

While editing, run the narrowest relevant command:

- one test file or `vitest related --run` for a focused behavior change;
- the owning package's `test`, `typecheck`, `lint`, or `build` command when package behavior is
  involved;
- direct tooling or contract tests for scripts, workflows, manifests, and release policy;
- `pnpm docs:generate:indexes`, `pnpm format`, and the appropriate docs check for docs-only changes:
  use `pnpm docs:check:pr -- --from <base> --to <head>` for PR scope or `pnpm docs:check` for a
  full configured-scope audit.

Before pushing, rerun focused evidence appropriate to the final diff. Do not automatically run a
repository-wide local gate. Broader local or service-backed diagnostics require a concrete suspected
cross-package or environment failure, an unavailable hosted equivalent, or a specific hosted-CI
failure to reproduce.

## Hosted PR CI job reproduction

The workflow in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) owns comprehensive
validation and records actionable logs/manifests. Reproduce the failing job directly:

- repository policy: the exact failing command, such as `pnpm env:validate:example`,
  `pnpm test:tooling`, `pnpm run lint:workflows`, `pnpm run lint:shell`, `pnpm docker:lint`,
  `pnpm deps:audit:strict`, `pnpm release:verify:contracts`,
  `pnpm guard:orchestrator:boundary`, `pnpm docs:check:pr`, or `pnpm docs:health:report`;
- build and code quality: `pnpm build`, `pnpm typecheck`, or `pnpm lint`;
- unit and component: the hosted recursive package command and its explicit workspace/Vitest
  resource settings from the job log;
- deterministic integration: `pnpm test:integration`;
- recording media: `pnpm --filter @esl-pipeline/batch-backend test:media`, with FFmpeg installed;
- backend DB and worker: isolated PostgreSQL 18 and Redis 8, explicit test URLs, the `_test`
  database safeguard, and the exact migration/PostgreSQL/worker commands from the job;
- Telegram: `bash scripts/smoke/run-telegram-ops-compose-smoke.sh` plus the Telegram-specific
  package and rollout evidence described by the current runbook.

The retained `pnpm test:backend:db:worker` helper is a narrow local service-test helper. It checks
reachability, constructs safe service-test environment variables, and invokes the backend migration,
PostgreSQL, and worker scripts with Windows-compatible process handling. It is not a full CI
reproduction command and does not claim to perform migration preflight beyond the commands it runs.
Its local Compose Redis fallback is `redis://127.0.0.1:6380`; explicit service-test URLs remain
authoritative.

## Backend test contracts

[`packages/batch-backend/vitest.projects.mjs`](../../packages/batch-backend/vitest.projects.mjs) is
the prerequisite-membership source of truth. It explicitly owns:

- pure unit tests as the discovered remainder;
- deterministic in-process HTTP tests;
- PostgreSQL migrations;
- PostgreSQL repositories and queries;
- PostgreSQL plus Redis worker tests;
- FFmpeg-backed recording media tests.

The pure project setup scrubs ambient PostgreSQL, Redis, Docker, provider, and repository `.env`
inputs before test modules load, sets `VALIDATION_TEST_CLASS=pure`, and preserves poisoned-environment
isolation. Service-backed projects construct their explicit environment. Do not route backend tests
by filename alone or change project membership as part of validation-gate retirement.

Keep package-level test scripts that have concrete hosted or diagnostic callers. Remove aggregate
aliases whose only purpose was to assemble the retired local validation hierarchy; do not add a new
generalized local orchestrator.

## Test design and value

A passing suite is useful evidence only when its assertions protect meaningful behavior. Neither
the number of tests nor line coverage establishes that agent-authored tests can catch regressions.
Do not automatically add a test for every code change or ban test creation categorically.

Before adding or materially rewriting a test, identify the observable behavior, invariant, or
independently owned contract; the credible regression it should detect; and why an existing
owner-boundary test does not already cover that risk. Prefer one strong check at the behavior's
primary owner, with additional tests at other layers only for distinct transport, persistence,
concurrency, or lifecycle risks. Prefer compact, table-driven cases over repeated setup or copies.

Expected outcomes must come from an independent requirement, historical regression, or stable
contract example, not by calling the same production helper to calculate the expected value.
Mocks may isolate a dependency, but should not manufacture the result being asserted. Tests of
implementation details are justified when those details themselves form a durable, observable
contract; do not create production-only-for-tests exports, flags, or wrappers without a real need.

For a bug fix, demonstrate that its regression test fails on the buggy behavior for the intended
reason and passes with the repair when this is practical. Do not turn this into a universal
requirement to reconstruct old code or run an extra full suite.

Use the optional [`test-audit` skill](../../.agents/skills/test-audit/SKILL.md) for the detailed
authoring gate, scoped audits, and evidence-based pruning. This document owns repository testing
policy and the current test/CI commands; the skill must not override those rules.

## Fixture and snapshot drift

**A test failing on an outdated fixture is a diagnosis task, not permission to update the
fixture until CI is green.** A fixture is either current representative test input, a deliberate
negative/edge case, a generated preview artifact, or a pinned historical/golden contract
baseline. Identify which kind and which independent authority it represents first.

When a fixture, golden expectation, snapshot, or mock breaks:

1. Inspect the *first relevant failure* and the production/contract change. Identify the
   fixture's owner and whether the failure is a schema/input mismatch, changed observed behavior,
   irrelevant presentation drift, or a true regression. Do not bulk-update all failures.
2. **Bug or unintended behavior change:** repair the implementation; preserve the independent
   expected result. A failing assertion is not stale merely because code now produces something
   different.
3. **Intentional contract change:** update the *smallest canonical* fixture/source factory and
   affected expectations as part of that change, with an explicit reason and the authoritative
   new contract. Preserve versioned/historical fixtures and backward-compatibility checks unless
   the compatibility requirement is itself deliberately changed and approved.
4. **Incidental fixture churn:** if the behavior is unchanged but an oversized sample or exact
   snapshot breaks on unrelated fields, narrow the asserted semantic slice, replace duplicated
   static copies with one small typed test fixture/builder where suitable, or delete truly
   redundant assertions after proving equivalent surviving coverage. Do not loosen a meaningful
   invariant just to reduce maintenance.
5. **Unclear cause:** inspect the owner and callers before editing expectations. Never use
   wholesale snapshot regeneration, broad find/replace, or current production output as the
   sole oracle for the new expected value.

Keep variable timestamps, random IDs, ordering not guaranteed by contract, and unrelated optional
fields out of golden expectations when possible; use deterministic inputs or deliberate
normalization *only for non-contractual fields*. A full-byte, hash-pinned, or historical fixture
can be the contract itself and must not be regenerated casually. Generated previews should be
regenerated from their canonical source with the resulting diff inspected, not hand-edited.

For a fixture-changing PR, report which contract changed (or did not), the specific fixture
source/expected values changed, why the previous value was obsolete, and which focused test
confirmed the desired behavior. Avoid growing fixtures or cascading unrelated updates merely to
make unrelated tests pass.

## Test portfolio maintenance

During ordinary maintenance, obsolete or superseded assertions may be removed when cheaper or stronger evidence still protects the same meaningful defect class. Before removing coverage, identify the plausible regression it uniquely catches and the surviving evidence for that regression. Do not retain tests merely because they already exist, but do not remove consequential coverage merely because it is mocked, old, slow, or implementation-coupled.

## Evidence and merge boundary

Report the exact focused commands run and their outcomes. Distinguish local evidence from hosted,
manual, and environment-owned evidence. A focused local pass means only that the covered scope
passed. Merge readiness requires every selected hosted PR job and `CI gate` to succeed.

Historical acceptance records and archived documents may mention commands that were valid when they
ran; they are not current instructions and do not justify restoring compatibility aliases.
