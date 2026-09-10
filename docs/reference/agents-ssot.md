# ESL Pipeline Agent Handbook (SSOT)

## Meta

- Audience: maintainers and AI agents implementing or reviewing repo behavior.
- Authority Level: authoritative contracts and invariants.
- Last Verified Against: 2026-08-31 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly and after contract-level changes.
- Status: `reference`.

This is the canonical repo contract. If it conflicts with `AGENTS.md`, router docs, or package READMEs, this document wins.

## Read Selectively

Start with `AGENTS.md` and `docs/README.md`, then use this file for hard rules:

- runtime and verification baseline
- ownership and extension boundaries
- forbidden changes
- contract-preserving workflows

For deep system maps, prefer the linked docs rather than growing this file again.

## Ownership Model

### Canonical package boundaries

- `@esl-pipeline/orchestrator`
  - canonical pipeline semantics and manifest behavior
  - library-only surface; no CLI/wizard/path-picker runtime
- `@esl-pipeline/batch-backend`
  - operational HTTP + worker surface
  - persistence, queuing, auth, and workflow orchestration
- `@esl-pipeline/batch-frontend`
  - operator UI over `batch-backend`
- `@esl-pipeline/telegram-ops-bot`
  - operator control-panel adapter over authenticated `batch-backend` operations
  - no independent pipeline, persistence, or deployment semantics
- supporting implementation packages
  - validation/parsing: `md-validator`, `pmd`
  - adapters/providers: `html-publisher`, `tts-*`, `stt-*`, `storage-uploader`
  - shared runtime utilities: `provider-runtime`, `shared-infrastructure`, `contracts`

### Source-of-truth rules

- pipeline semantics -> orchestrator
- public DTOs / transport payloads -> `@esl-pipeline/contracts`
- live capability status -> `docs/backend-frontend/backend-frontend-alignment.md`
- environment policy -> `docs/reference/env.md`
- generation provider/model policy -> `docs/reference/GENERATION_PROVIDER_POLICY.md`
- operational procedures -> `docs/operations/*`
- development/deployment workflow -> `docs/backend-frontend/DEPLOYMENT.md`

## Non-Negotiable Invariants

### Pipeline and runtime

- Do not bypass orchestrator contracts for pipeline behavior changes.
- Do not silently change stage order or meaning for validate/import/colorize/voice-plan/speech-plan/tts/upload/add-audio/manifest.
- Manifest behavior is contract-level; changes must be coordinated with tests and docs.
- New schema-5 study-text voice plans emit `ranked`, `deterministic`, or `fallback` resolution modes.
  Manifests containing the older `resolved` token normalize it to `deterministic` when read.
- Authored lesson Markdown stays provider-neutral. Provider capability resolution and expressive
  speech rendering happen after TTS provider/model selection.
- Study-text performance mode is orchestrator-owned: authored `dialogue` stays dialogue, authored
  `tts` stays monologue, and `auto` resolves dialogue only for two or more distinct authored
  speakers. Schema-v2 directions merge by dimension into one Inworld instruction; pronunciation
  remains planner-free.
- Rerun family selection is contract-level:
  - unchecked study-text / pronunciation families must preserve prior published artifacts and persisted family defaults
  - checked families must replace the published artifact for that family even when deterministic upload keys or hashes are unchanged
  - pronunciation-family reruns may reuse individual prior clips only when the previous manifest
    proves the clip-level audio identity is unchanged; changed clips in a selected family still
    require replacement upload semantics
- `batch-backend` may orchestrate and persist work, but it must not invent alternate pipeline semantics.

### Contracts and compatibility

- Public request/response DTO changes must go through `@esl-pipeline/contracts`.
- Do not silently rename or repurpose manifest/config fields.
- Backward compatibility should remain unless a breaking change is explicit, planned, and versioned.
- Legacy compatibility paths should be retired deliberately, never by drift.

### Schema and persistence

- Database changes belong in versioned migrations.
- Runtime legacy schema patching is emergency-only and must not become the normal change path.
- Durable workflow state, action history, and lineage are backend responsibilities, not frontend inventions.

### Security and config

- Never hardcode secrets.
- Prefer canonical namespaced env vars over legacy aliases.
- Fail-safe defaults matter more than convenience defaults for auth, quotas, and mutating operations.

### Development, CI, and production runtime

- Treat the developer laptop as the primary development environment for editing code, installing
  dependencies, running dev servers, debugging, tests, integration checks, and migration tests.
- Treat Git commits plus CI validation as the source of truth for deployable code. Production
  deployments must be reproducible from committed code, not server-local edits.
- Treat the AWS Lightsail VPS as production runtime: pull selected images, apply reviewed
  migrations once, serve traffic, run health checks, keep production data, emit logs, and run
  backup/restore operations.
- Do not use the production VPS as the normal coding, hot-reload, full-test-suite, or repeated image
  build environment. Do not install a self-hosted CI runner there.
- Prefer CI-built Docker images tagged by Git commit SHA for production deployments. Avoid relying
  only on mutable tags such as `latest`; record the deployed Git SHA or image version in deployment
  evidence.
- PR CI owns application readiness. Merge to `main` automatically starts the release workflow,
  which decides versioning and publishes immutable images. Production deployment remains a separate
  operator action. Do not defer required release-blocking evidence to a nightly or post-merge run.
- Every PR to `main` must carry exactly one label from `release:none`, `release:patch`,
  `release:minor`, or `release:major`. `release:none` is valid only when the fail-closed release
  policy classifies the complete PR file set as maintenance-only; deployable and unknown changes
  require a versioned release.
- Production Compose app services must be pull-based. Do not reintroduce production `build:`,
  `:local` app tags, `pull_policy: never`, or `up --build` for backend, frontend, bot, or worker
  services. Keep Docker orchestration and backups host-side rather than mounting `/var/run/docker.sock`
  into the long-running backend.
- Use SSH for deployment, status/log inspection, resource checks, reviewed migrations, backups,
  production-only diagnosis, and emergency recovery. If an emergency server edit is unavoidable,
  reproduce it locally, commit it, and redeploy normally as soon as possible.
- Keep persistent production data outside the application source checkout. Do not manually mutate
  files inside running containers.

## Safe Change Rules

### When changing pipeline behavior

Update together:

- orchestrator code
- affected package tests
- this SSOT if the contract changes
- relevant runbook/reference docs

### When changing backend/frontend workflow behavior

Update together:

- backend or frontend implementation
- `docs/backend-frontend/backend-frontend-alignment.md`
- relevant package README
- `docs/reference/env.md` if config changed

### When changing docs/tooling/governance

Update together:

- `scripts/docs/*` and config
- docs governance/playbook docs
- routers if the doc graph changes

### Agent harness and instruction boundaries

- Root `AGENTS.md` contains durable repo-wide guidance and routes; keep task-specific implementation
  detail in plans or task docs.
- Use nested `AGENTS.md` files only for repeated subtree-specific overrides.
- Reusable procedures belong in skills; deterministic requirements belong in scripts, hooks, or CI.
- Active plans define the outcome, constraints, and verification for plan-backed tasks; explicitly
  approved Goal Contracts define the stable outcome boundary for goal-backed orchestration. After
  implementation lands, current code, contracts, package READMEs, and reference/runbook docs outrank
  either execution handoff.
- A freshness-date change is valid only after content verification under
  `docs/reference/DOCS_GOVERNANCE.md`; date-only CI unblocking is forbidden.

## Runtime and Verification Baseline

- Node.js 24.15.0+
- Use the repo-pinned Node version in `.nvmrc` for local development and CI parity; the engine range
  above remains the compatibility floor.
- pnpm
- system ffmpeg where provider flows require it

Required repo checks for behavior changes:

- During editing, run the narrowest relevant package, file, or `vitest related --run` lane first.
- After focused tests, choose one normal pre-push gate. Use
  `pnpm --silent run check:fast:agent` by default, use `pnpm check:pre-pr:agent` when an agent runs
  a broad, cross-cutting, shared-contract, or toolchain gate, and use `pnpm check:agent` for full CI
  reproduction or DB, migration, worker, or integration behavior. The corresponding non-agent
  commands remain the human-readable equivalents. Clearly docs-only work may use the documented
  docs-specific lanes.
- `check:fast` is affected-package validation. It must include committed, staged, unstaged, and
  untracked changes; expand to workspace dependents; run cheap global guards; apply explicit
  path-risk rules; and fail conservatively to a broader lane when the affected scope is uncertain.
- `check:fast:dry-run` must show local working-tree scope separately from the committed hosted CI
  preview. A `check:fast:agent` fallback to `check:pre-pr` satisfies the broad gate.
- `check:pre-pr` is the direct gate for a branch already known to be broad. It runs the broad build,
  typecheck, lint, and core unit regression sweep.
- Affected and broad local validation run selected lanes serially to completion. Independent lanes
  continue after another lane fails; prebuilt test lanes are blocked when their build prerequisite
  fails. The aggregate summary and cited raw logs are the canonical diagnostic starting point.
- Backend test class is an operational contract, not a filename convention. The manifest at
  `packages/batch-backend/tests/test-routing.json` positively owns deterministic HTTP, PostgreSQL
  migration, PostgreSQL query, and PostgreSQL + Redis worker suites. Unit is the discovered remainder
  and must not import known service bootstrap signals.
- `test:check-routing` is always selected locally and must pass before unit execution. Canonical local
  and agent unit lanes run with ambient PostgreSQL, Redis, Docker endpoint, and provider credentials
  removed and `VALIDATION_TEST_CLASS=pure`. Explicit DB/worker lanes preserve their constructed
  service environment.
- Selected PostgreSQL and Redis lanes remain visible in affected plans with CI ownership. Local
  validation reports them as `ciRequirements` and does not silently start services. A local run with
  all executed lanes passing and outstanding CI evidence reports `PASS_WITH_CI_REQUIREMENTS`; this
  permits PR creation but not merge.
- An isolated rerun is allowed only to diagnose a specific failure and does not replace the complete
  gate result. Allow at most one isolated diagnostic rerun per unchanged failure. Repeat the complete
  gate only after relevant source, configuration, toolchain, or a diagnosed prerequisite condition
  changed. Stop and report a stable infrastructure or prerequisite failure instead of assembling a
  green cache through reruns.
- Agent variants preserve validation scope and exit semantics; they change only output presentation
  and persisted evidence.
- A successful `pnpm check` or `pnpm check:agent` subsumes both narrower pre-push gates.
- Run `pnpm check` for human-readable local CI reproduction, or `pnpm check:agent` when the same
  full gate needs persisted agent evidence, including for DB, migration, worker, integration, or
  similarly broad behavior changes.

Canonical blocking PR check names are `CI gate`, `static checks (node 24.x)`,
`integration lane (blocking)`, `backend db + worker integration (blocking)`, and
`telegram command-loop compose smoke`. `CI gate` is the aggregate result and should become the
single branch-protection requirement when repository plan capabilities permit. Every selected job
must succeed; a required job that is missing, cancelled, or unexpectedly skipped fails the gate.

Docs-heavy changes also require:

- `pnpm docs:generate:indexes`
- `pnpm format`
- `pnpm docs:check`

## Environment and Entrypoints

- Executable entrypoints should bootstrap env through shared `loadCliEnv()` or a thin wrapper around it.
- Do not reintroduce ad-hoc dotenv parsing.
- Host and container runtime contexts are different:
  - Compose-safe defaults stay canonical for containers.
  - Host-side tools should adapt internally instead of forcing env churn.

## High-Signal Task Routing

- pipeline/runtime behavior:
  - `packages/orchestrator/README.md`
  - `docs/PIPELINE_INTEGRATION_VISION.md`
- backend operational surface:
  - `packages/batch-backend/README.md`
  - `docs/backend-frontend/batch-backend-ssot.md`
- frontend workflow/state:
  - `packages/batch-frontend/README.md`
  - `docs/backend-frontend/backend-frontend-alignment.md`
- environment and providers:
  - `docs/reference/env.md`
  - `docs/reference/GENERATION_PROVIDER_POLICY.md`
  - `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`
- docs governance:
  - `docs/reference/DOCS_GOVERNANCE.md`

## Forbidden Shortcuts

- Do not use archive docs as current truth.
- Do not move active behavior explanations only into PR text or chat.
- Do not widen mutating operational surfaces without updating the relevant runbook and safety model.
- Do not treat package READMEs as substitutes for canonical contracts.

## Related

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/README.md`](../README.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../backend-frontend/backend-frontend-alignment.md)
- [`docs/reference/env.md`](env.md)
