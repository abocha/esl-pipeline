# ESL Pipeline Agent Handbook (SSOT)

## Meta

- Audience: maintainers and AI agents implementing or reviewing repo behavior.
- Authority Level: authoritative contracts and invariants.
- Last Verified Against: 2026-09-14 repo state.
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
  - learner presentation: `learner-handout` (sole native React renderer, deterministic Node static
    documents and local Vite fixtures; html-publisher owns publication identity)
  - domain validation: `contracts` (AssignmentV1)
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
- Authored AssignmentV1 lesson text stays provider-neutral. Provider capability resolution and expressive
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

- Student is the sole foundational learner-profile ownership root. Profile revisions belong to
  `student_profile_revisions.student_id`; active status plus the partial unique index is canonical.
  Authenticate, resolve workspace, authorize student, then read or mutate its revision. Direct
  global profile IDs, catalogs, sharing and student/profile binding machinery are retired.
- Preserve historical assignment and prompt-package revision/hash/version evidence. Legacy profile
  IDs in snapshots or migration provenance are metadata, never runtime authority. Residual frozen
  tables require the [ABO-12 reconciliation procedure](../operations/student-profile-revision-cutover.md)
  before destructive removal; do not infer student ownership from creators.

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
- Focused local checks are the default. Broad local aggregation requires a concrete plausible wider
  failure to catch before CI, local environment behavior under test, unavailable equivalent hosted
  evidence, or a specific CI failure being reproduced or diagnosed. Diff breadth alone is not a
  reason. Clearly docs-only work may use the documented docs-specific lanes.
- Hosted PR CI is the comprehensive merge gate for the resource-constrained developer laptop. A task
  with focused evidence covering its plausible failure modes may be ready for hosted CI without a
  repository-wide local gate. If hosted CI fails, inspect its logs/artifacts and reproduce that
  job's actual commands, configuration, and prerequisites.
- The committed hosted scope helper preserves name-status parsing, workspace discovery, relevant
  path/package classification, transitive workspace-dependent projection, and hosted CI output and
  summary formatting. It represents explicit repository-maintenance-only paths separately from
  docs-only paths; those paths require repository-policy evidence but do not select application
  evidence lanes. Package impact selects build/unit; explicit ownership independently selects
  integration, DB/worker, Telegram and media. Docs tooling under `scripts/docs/**` stays in repository
  policy. Classifier/workflow/root toolchain changes bootstrap full application evidence independently
  of the edited classifier. This classification is independent of release labels, and unknown or ambiguous
  paths remain fail-closed. The production-image selector shares workspace/dependency impact logic
  and retains transitive dependent coverage. It does not collect local working-tree scope or plan
  local lanes.
- Backend test class is an operational contract, not a filename convention. The executable Vitest
  project model at `packages/batch-backend/vitest.projects.mjs` is the sole prerequisite-membership
  SSOT. It retains the established deterministic HTTP prefix and positively owns PostgreSQL migration,
  PostgreSQL query, PostgreSQL + Redis worker, and real media suites. Unit is the discovered remainder
  and must not import known service bootstrap signals.
- PR CI reuses the production-image scope to select the exact backend release Docker build when
  shared image inputs or the affected workspace graph can change that image. This conditional lane
  is required by `CI gate` when selected and may be skipped only when the production-image scope
  excludes the backend.
- Package-local Vitest project setup establishes the pure environment before test modules load,
  including for direct package entrypoints. It removes ambient PostgreSQL, Redis, Docker endpoint,
  provider, and repository `.env` inputs and sets `VALIDATION_TEST_CLASS=pure`; explicit DB/worker
  projects preserve their constructed service environment.
- An isolated rerun is allowed only to diagnose a specific failure and does not replace the complete
  gate result. Allow at most one isolated diagnostic rerun per unchanged failure. Repeat the complete
  gate only after relevant source, configuration, toolchain, or a diagnosed prerequisite condition
  changed. Stop and report a stable infrastructure or prerequisite failure instead of assembling a
  green cache through reruns.
- Use the smallest relevant package test, typecheck, lint, or build command while editing and before
  pushing. Use `pnpm test:backend:db:worker` only for a concrete local PostgreSQL/Redis diagnostic.
  It is a narrow reachability, environment-construction, and Windows-compatible invocation helper,
  not a comprehensive local CI wrapper.

Canonical blocking PR check names are `CI gate`, `repository policy (node 24.x)`,
`build + code quality (node 24.x)`, `unit + component (node 24.x)`,
`deterministic integration (blocking)`, `recording media (blocking)`, `backend db + worker integration (blocking)`, and
`telegram command-loop compose smoke`; the conditional packaging check is
`production backend packaging`. `CI gate` is the aggregate result and should become the
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

### AssignmentV1 native execution (ESL-6)

Structured jobs execute frozen, validated AssignmentV1 directly through orchestrator, TTS and native
HTML; typed preview uses the same renderer. No active PMD projection or temporary Markdown source
is created. Native React renderer 3 / manifest schema 6 carry canonical assignment and publication
metadata; API 9 / validator 3 retire Markdown processing while manifest contract 4 keeps historical
read semantics. Historical Markdown and renderer-1 manifests are read-only evidence under ABO-30.
No correction, retry, rerun, resume, rendering, TTS, publication, memory processing or conversion is supported. Editable JSON authority, source authorization, CAS,
lineage, cast/speech provenance and selected audio-family reuse remain unchanged. See
[AssignmentV1](ASSIGNMENT_V1.md) for the canonical execution contract.
Migration 0065 admits renderer-3 job writes with existing artifact checks and the frozen-identity
trigger unchanged. It must precede new native execution writes and blocks previous-image recovery
that cannot truthfully execute renderer 3. No v1/v2 executable renderer is retained.
