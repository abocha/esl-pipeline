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

## Choose the evidence route

Start from the changed behavior and the plausible regression, then follow the applicable route.
These are entrypoints, not a checklist to read in full for every task.

| Task                                     | Next owner                                                                                                                                                                      | Evidence decision                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary application change              | Owning package README and existing tests; [backend recipe](../../packages/batch-backend/README.md#validation)                                                                   | Use an existing owner-boundary check or a focused regression test. Add package build, typecheck or lint evidence when the changed surface needs it. |
| Docs or instruction change               | [Docs-only recipe](#docs-only-changes)                                                                                                                                          | Synchronize affected generated references, check formatting and run the appropriate docs mode.                                                      |
| Hosted failure                           | [Selected job reproduction](#hosted-pr-ci-job-reproduction)                                                                                                                     | Inspect retained job logs/artifacts, then reproduce the first relevant failure's command and prerequisites if needed.                               |
| Validation-system change                 | [Infrastructure skill](../../.agents/skills/esl-pipeline-validation-evidence/SKILL.md) and [SSOT contracts](agents-ssot.md#runtime-and-verification-baseline)                   | Follow the changed mechanism to existing contract cases; use services only when the actual service boundary needs evidence.                         |
| Test authoring, audit or fixture failure | [Test-value policy](#test-design-and-value), [fixture classification](#fixture-and-snapshot-drift), applicable [test-audit procedure](../../.agents/skills/test-audit/SKILL.md) | Identify the independent contract and defect-catching value before adding, deleting or updating expectations.                                       |

Package READMEs own execution recipes; manifests, test configuration and workflows own exact commands,
membership and prerequisites. This guide owns evidence selection; the SSOT owns validation invariants.
Remembered commands and historical results are discovery hints, not current execution instructions.

Before running checks, inspect [existing evidence](#evidence-and-merge-boundary) for applicability.
Broader local or service-backed evidence requires a concrete plausible wider failure, local environment
behavior under test, an unavailable hosted equivalent or a specific hosted failure to diagnose. Diff
breadth alone does not justify a broad run. Finish when the applicable completion criteria are met,
following the [decision-bounded closure rule](../../.codex/ORCHESTRATION.md#decision-bounded-evidence-and-closure).

## Local feedback ladder

The root Vitest configuration aliases HTML publication and storage upload to their canonical
compiled workspace entries. This keeps upload mocks shared across pnpm's injected workspace
copies while exercising the real renderer and publication flow. Build the package graph before
running these prebuilt tests; do not replace their imports with unbuilt source aliases.

The root Vitest setup isolates orchestrator, storage-uploader, provider-runtime and STT/TTS
provider unit tests before test modules initialize, including direct package, watch and prebuilt
entrypoints. It reuses `scripts/test/pure-test-env.mjs`, disables SDK user-profile/ADC credential
files and AWS metadata discovery, and sets `VALIDATION_TEST_CLASS=pure`. Application/CLI env
bootstrap and mutating shared env loaders skip env files in pure mode; explicit non-mutating
`loadEnvFiles({ assignToProcess: false })` remains available for parser fixtures.

The setup blocks external fetch and TCP/TLS connections before dispatch, including unmocked SDK
requests. Literal loopback addresses and localhost remain available to intentional mock servers.
Integration suites (including ElevenLabs' `tests/integration.test.ts`) and backend project/service
classification retain their existing setup. This guard covers in-process Node transports, not
arbitrary subprocesses or native networking. Reproduce the dummy-credential/env-file regression
after building the orchestrator test prerequisites:

```bash
pnpm --filter @esl-pipeline/orchestrator test:unit:setup
node --test scripts/test/provider-unit-isolation.mjs scripts/test/pure-test-env.test.mjs
```

While editing, run the narrowest relevant command:

- one test file or `vitest related --run` for a focused behavior change;
- the owning package's `test`, `typecheck`, `lint`, or `build` command when package behavior is
  involved;
- direct tooling or contract tests for scripts, workflows, manifests, and release policy;
- the [docs-only recipe](#docs-only-changes) for documentation and instruction changes.

Before pushing, rerun focused evidence appropriate to the final diff. Do not automatically run a
repository-wide local gate. Broader local or service-backed diagnostics require a concrete suspected
cross-package or environment failure, an unavailable hosted equivalent, or a specific hosted-CI
failure to reproduce.

## Docs-only changes

From repo root, refresh generated references when affected and check formatting:

```bash
pnpm docs:generate:indexes
pnpm exec prettier --ignore-path .prettierignore --check <changed-markdown-or-yaml-files>
pnpm docs:check:pr -- --from <base> --to <head>
```

Replace the formatter placeholder with explicit changed file paths. The explicit ignore file keeps
Git-ignored but tracked skill files from being silently skipped. Use `--write` on those paths
when a formatting repair is needed; `pnpm format` includes repository-wide code checks and belongs
to a formatting audit or the hosted job that requires it, not the ordinary docs-only local recipe.

Replace `<base>` and `<head>` with the actual comparison refs. PR mode validates the configured
documents structurally and treats age-only findings as advisory; it is not a changed-files-only
checker. It also compares local path/Markdown-anchor regressions in authored changed Markdown and
directly affected unchanged consumers against the merge base, including skills and archive moves
outside the configured set. Existing debt in that additional scope remains non-blocking; raw runtime
prompt/fixture content is excluded. The [link checker](../../scripts/docs/pr-markdown-links.mjs)
defines its supported syntax; literal source references and unsupported Markdown forms still need
inspection when material. These checks do not establish semantic currentness.
The comparison requires a non-empty committed diff; after a task commit exists, compare its
actual base and head. The checker reads current working-tree documents. Inspect the resulting Git
diff after generation or formatting.

Use `pnpm docs:check` for a full audit with repository-wide age enforcement, such as scheduled
gardening. Before advancing an enforced document's `Last Verified Against` date, follow the
[governed verification procedure](DOCS_GOVERNANCE.md#verification-procedure) and record what was
reviewed; an ordinary docs-only PR does not itself satisfy that audit. Do not turn an unrelated age
warning into additional cleanup during a bounded change. The
[docs governance contract](DOCS_GOVERNANCE.md#harness-contract) owns the distinction between modes.

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

1. Inspect the _first relevant failure_ and the production/contract change. Identify the
   fixture's owner and whether the failure is a schema/input mismatch, changed observed behavior,
   irrelevant presentation drift, or a true regression. Do not bulk-update all failures.
2. **Bug or unintended behavior change:** repair the implementation; preserve the independent
   expected result. A failing assertion is not stale merely because code now produces something
   different.
3. **Intentional contract change:** update the _smallest canonical_ fixture/source factory and
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
normalization _only for non-contractual fields_. A full-byte, hash-pinned, or historical fixture
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

For reused evidence, identify the command and covered behavior, result/log or hosted run/job/artifact,
and the source/configuration and prerequisites it exercised. Check subsequent changes against that
coverage. A matching HEAD with a dirty flag does not establish unchanged working-tree content;
unknown execution continuity requires fresh evidence for the affected behavior. Reuse unaffected
evidence and run only the newly uncovered checks, subject to required hosted checks on the final head.

For an unchanged failure, allow at most one isolated rerun when it can resolve a concrete uncertainty.
A broader rerun requires a relevant source, configuration, toolchain or diagnosed prerequisite change.
Report a stable infrastructure failure instead of repeating runs to accumulate green results.

Historical acceptance records and archived documents may mention commands that were valid when they
ran; they are not current instructions and do not justify restoring compatibility aliases.

## Hosted CI implementation notes

Read this section when changing hosted scope, packaging or job setup. Routine local work starts
with the evidence route above; the workflow owns current job commands.

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
Release image builds retain their cache imports and do not export caches. Their `pull_request_target`
trigger keeps the default read-only cache access; the workflow does not grant write-capable cache
access. Shared image inputs and workspace changes that affect the backend select the job; unrelated
PRs skip it. `CI gate` requires the job to succeed whenever selected.

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

### Recording-media job setup

The `recording-media` job installs FFmpeg concurrently with frozen pnpm dependency installation
and the backend prerequisite build in one Bash step. The step waits for apt completion, propagates
apt/install/build failures, and waits for apt during exit cleanup before media tests can run.
Build/test logs and the required `CI gate` remain unchanged. Reduced wall time and rounded billed
job-minutes are predictions until hosted CI measures them against the 61s/78s baseline; report the
observed duration even if it remains above 60 seconds.
