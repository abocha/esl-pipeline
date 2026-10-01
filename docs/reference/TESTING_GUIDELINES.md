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

The conditional `production backend packaging` job reuses the release production-image scope and
executes the same backend Dockerfile, Buildx action, target platform, and fresh-base behavior as the
release image build, without pushing an image. Shared image inputs and workspace changes that affect
the backend select it; unrelated PRs skip it. `CI gate` requires the job to succeed whenever selected.

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

## Test portfolio maintenance

During ordinary maintenance, obsolete or superseded assertions may be removed when cheaper or stronger evidence still protects the same meaningful defect class. Before removing coverage, identify the plausible regression it uniquely catches and the surviving evidence for that regression. Do not retain tests merely because they already exist, but do not remove consequential coverage merely because it is mocked, old, slow, or implementation-coupled.

## Evidence and merge boundary

Report the exact focused commands run and their outcomes. Distinguish local evidence from hosted,
manual, and environment-owned evidence. A focused local pass means only that the covered scope
passed. Merge readiness requires every selected hosted PR job and `CI gate` to succeed.

Historical acceptance records and archived documents may mention commands that were valid when they
ran; they are not current instructions and do not justify restoring compatibility aliases.
