# ESL Pipeline Agent Handbook (SSOT)

## Meta

- Audience: maintainers and AI agents implementing or reviewing repo behavior.
- Authority Level: authoritative contracts and invariants.
- Last Verified Against: 2026-03-05 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly and after contract-level changes.
- Status: `reference`.

Authoritative instructions for AI agents and maintainers operating in this repo.

This document is the machine-consumable Single Source of Truth (SSOT) for how to reason about, modify, and extend the ESL Pipeline monorepo. It encodes contracts, invariants, extension points, and workflows. Automated agents MUST treat this file as higher priority than general-purpose documentation when instructions conflict.

If any statement here conflicts with guidance in [`AGENTS.md`](AGENTS.md) or [`README.md`](README.md), this document wins for automation.

## SSOT Quick Index (Read Selectively)

Start with `AGENTS.md` and `docs/README.md`; then read only the sections needed for the current task.

- Runtime/tooling/env requirements: section `3`.
- Package ownership and extension points: section `4`.
- Orchestrator/batch ownership review artifacts:
  - `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`
  - `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`
- Configuration and adapter rules: section `5`.
- Manifest and pipeline behavior contracts: section `6`.
- Programmatic API + legacy CLI constraints: section `7`.
- Safety rails and extension playbooks: sections `8` and `9`.
- CI/release/workflow constraints: sections `10`, `11`, and `12`.

---

## 1. Document Meta: Purpose, Scope, and Usage

### 1.1. Purpose

This document enables deterministic decisions by AI agents and maintainers without guessing. It defines:

- What is stable API vs internal detail.
- Where each behavior is implemented.
- Which changes are allowed, which require coordination, and which are forbidden.
- How to map common tasks (e.g., new CLI flags, adapters, manifests) onto concrete files and exports.

Human-facing docs (e.g. [`README.md`](README.md)) explain conceptual usage. This SSOT explains:

- Exactly where to read/write.
- Which invariants MUST hold.
- How to keep code, docs, and automation in sync.

### 1.2. Target Audience and Execution Model

Target persona:

- Runs in constrained environments (e.g. code mods via tools).
- Uses operations like:
  - `read_file`
  - `insert_content`
  - `apply_diff`
  - `write_to_file`
  - `execute_command`
- Works from the repo root `/home/.../esl-pipeline` (path may differ, but instructions assume repo root as working directory).
- MUST:
  - Prefer existing exports and public APIs over inventing new ones.
  - Reference specific files and declarations when changing behavior, e.g.:
    - [`packages/orchestrator/src/pipeline.ts`](packages/orchestrator/src/pipeline.ts)
    - [`createPipeline.declaration()`](packages/orchestrator/src/pipeline.ts)
    - [`loadEnvFiles.declaration()`](packages/orchestrator/src/index.ts)
    - [`resolveManifestPath.declaration()`](packages/orchestrator/src/pipeline.ts)
  - Treat this SSOT as authoritative for allowed operations.

Agents MUST NOT modify this SSOT speculatively. Changes follow section 12 (Design Notes).

### 1.3. How to Consume This Document (for Agents)

Interpretation rules:

- Keywords:
  - MUST / MUST NOT: hard requirements.
  - SHOULD / SHOULD NOT: strong guidance; deviations require explicit justification and tests.
  - MAY: optional, safe operations.
- When planning a change:
  1. Consult this SSOT.
  2. Inspect referenced source files and tests.
  3. Cross-check human docs in [`README.md`](README.md), [`AGENTS.md`](AGENTS.md), [`docs/`](docs).
  4. If behavior remains ambiguous or marked “to be confirmed,” treat it as requiring human approval before implementation.

Sections or bullets explicitly labeled “to be confirmed” describe intended future behaviors. Agents MUST NOT assume they are implemented until confirmed in code.

---

## 2. High-Level Architecture and Data Flow

### 2.1. Monorepo Layout Snapshot

The ESL Pipeline is a pnpm-based monorepo. Core directories:

- [`packages/orchestrator`](packages/orchestrator)
  - Canonical programmatic pipeline entry point.
  - Legacy CLI compatibility surface (deprecated; not the operational path).
- [`packages/shared-infrastructure`](packages/shared-infrastructure)
  - Shared infrastructure utilities for environment loading, storage configuration, and manifest resolution.
- [`packages/md-validator`](packages/md-validator)
  - Markdown validation.
- [`packages/pmd`](packages/pmd)
  - PMD parsing + study text extraction from Markdown.
- [`packages/notion-adapter`](packages/notion-adapter)
  - Notion-specific adapter used by orchestrator; serves as the template for future adapters.
  - Handles Notion import, heading presets, and audio attachment.
- [`packages/tts-core`](packages/tts-core)
  - TTS provider registry, contracts, and orchestration surface.
- [`packages/tts-provider-elevenlabs`](packages/tts-provider-elevenlabs)
  - ElevenLabs provider adapter (uses system `ffmpeg`).
- [`packages/tts-provider-google`](packages/tts-provider-google)
  - Google Cloud provider adapter (uses system `ffmpeg`).
- [`packages/storage-uploader`](packages/storage-uploader)
  - File upload (e.g. S3); used by orchestrator.
- [`packages/html-publisher`](packages/html-publisher)
  - HTML rendering and publishing helpers for batch/orchestrator surfaces.
- [`packages/provider-runtime`](packages/provider-runtime)
  - Shared provider runtime policy/classification helpers.
- [`packages/orchestrator/configs`](packages/orchestrator/configs)
  - Default presets, voices, and student configs.
- [`docs`](docs)
  - Architecture, manifest schema, backend groundwork.
- [`fixtures`](fixtures)
  - Sample Markdown and manifests for tests.

Key invariant:

- [`packages/orchestrator`](packages/orchestrator) is the integration hub and behavioral source of truth for the pipeline. Supporting packages are implementation modules behind its contracts unless explicitly documented as public.

### 2.2. End-to-End Pipeline Flow

Canonical pipeline stages (implemented via orchestrator and subpackages):

1. Markdown validation
   - Uses [`packages/md-validator`](packages/md-validator) and related logic.
2. Study text extraction
   - Uses [`packages/pmd`](packages/pmd).
3. Notion import + heading presets + audio attachment
   - Uses [`packages/notion-adapter`](packages/notion-adapter).
4. Text-to-speech (TTS) generation
   - Uses [`packages/tts-core`](packages/tts-core) with explicit provider adapters.
5. Upload/storage
   - Uses [`packages/storage-uploader`](packages/storage-uploader) (e.g., S3).
6. Manifest persistence
   - Uses `ManifestStore` interface from [`packages/orchestrator/src/manifest.ts`](packages/orchestrator/src/manifest.ts).

Stage order and semantics:

- The orchestrator’s implementation in:
  - [`packages/orchestrator/src/index.ts`](packages/orchestrator/src/index.ts)
  - [`packages/orchestrator/src/pipeline.ts`](packages/orchestrator/src/pipeline.ts)
- This sequence and meaning are a contract.
- Agents MUST NOT reorder, remove, or change core stage semantics without:
  - Updating orchestrator implementation.
  - Updating all affected tests.
  - Updating this SSOT and relevant docs.

Textual diagram (for reference):

- Markdown (.md)
  -> validate
  -> extract study text
  -> create/update Notion page
  -> apply heading presets + attach audio
  -> generate TTS audio
  -> upload audio (e.g., S3)
  -> attach audio in Notion
  -> write/update manifest

Validation invariants:

- Markdown validation MUST run before any import is skipped; `--skip-import` still performs the full
  validation stage to catch structural issues.

### 2.3. Data Artifacts and Ownership

Key artifacts:

- Markdown lesson source (input)
  - Ownership: caller; validated by `md-validator` and read by `pmd`.
- Notion page(s)
  - Ownership: external Notion workspace.
  - Managed via `notion-adapter`.
- Audio files
  - Local temporary output + remote URLs (e.g., S3).
  - Owned by `tts-core` + provider adapters + `storage-uploader`.
- Assignment manifest
  - Canonical record of the pipeline run.
  - Schema documented in [`docs/reference/pipeline-manifest.md`](docs/reference/pipeline-manifest.md).
  - Implemented via [`packages/orchestrator/src/manifest.ts`](packages/orchestrator/src/manifest.ts).
  - Owned by orchestrator; MUST be considered the durable, machine-readable truth of run state.

---

## 3. Runtime, Tooling, and Execution Requirements

### 3.1. Core Requirements

Agents MUST respect:

- Node.js:
  - Minimum version: as specified in [`package.json`](package.json) / [`.nvmrc`](.nvmrc).
  - At time of writing: Node 24.11.1+ is required (LTS).
  - The root `package.json` sets `engines.node >=24.11.1` to enforce this in tooling/CI.
- Package manager:
  - `pnpm` 8+ (use `corepack enable`).
- FFmpeg:
  - Available on `PATH` or via `FFMPEG_PATH`.
  - Required by `tts-provider-elevenlabs` and `tts-provider-google`.
- Module system:
  - ESM/modern TypeScript targets as configured in `tsconfig` files.

Verification commands (MUST pass before merging behavior changes):

- `pnpm install`
- `pnpm -r build`
- `pnpm lint`
- `pnpm test` (unit lane)
- `pnpm test:integration` (integration lane)
- `pnpm smoke` (or equivalent orchestrator smoke/integration suite)
- Dependency alignment:
  - `pnpm deps:pin` — normalize shared versions (AWS SDK, Notion, ElevenLabs, React/Vite, Fastify/pg/Redis/bullmq, etc.).
  - `pnpm deps:upgrade:safe` — upgrade allowlisted SDKs (Notion/ElevenLabs/AWS S3) and stable utilities (axios/remark/unified/commander/ora/picocolors; extras via `SAFE_UPGRADE_EXTRA`), then reapply pins.
  - `pnpm deps:check` — runs `deps:pin` and fails on drift (same guard used in CI).

CI workflows under [`.github/workflows`](.github/workflows) encode required checks; agents MUST keep them green or update them explicitly when compatibility changes.

### 3.2. Environment Loading

Environment handling:

- Executable entrypoints (CLI, workers, one-off tools):
  - MUST use shared env bootstrap helpers from [`@esl-pipeline/shared-infrastructure`](packages/shared-infrastructure):
    - `loadCliEnv(options)` for standard `.env` loading from CWD + repo root.
    - Package-local wrappers MAY be used when package-specific files are required (for example `.env.batch-backend`), but wrappers MUST delegate to `loadCliEnv` instead of reimplementing parsing.
- Programmatic API:
  - `loadEnvFiles` mirrors CLI behavior for consumers.
  - Agents SHOULD use `loadEnvFiles` rather than reimplementing env loading.

Required/commonly used environment variables (non-exhaustive; see README/backends docs):

- Notion:
  - `NOTION_TOKEN`
- TTS providers:
  - `ESL_TTS_DEFAULT_PROVIDER`
  - `ESL_TTS_PROVIDER_ORDER`
  - `ESL_TTS_PROVIDER_ELEVENLABS_API_KEY`
- AWS / storage:
  - `AWS_REGION`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - Optional manifest configuration vars (see section 5.2).
- Config/manifest adapters:
  - See section 5.2 and the backend docs bundle (read together, in order):
    - [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md) - unified reference for the batch frontend and backend system.
    - [`docs/backend-frontend/batch-backend-ssot.md`](docs/backend-frontend/batch-backend-ssot.md) - detailed backend internals and invariants.
    - [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md) - API contract status and gap tracking.

Agents:

- MUST NOT hardcode secrets.
- SHOULD model new configuration via environment variables or adapter options, consistent with existing patterns.

---

## 4. Package-by-Package Responsibilities and Extension Points

This section defines what each package owns, which exports are stable, and how to extend safely.

### 4.1. Orchestrator Package (Core)

#### 4.1.1. Role

[`packages/orchestrator`](packages/orchestrator):

- Exposes the programmatic API:
  - [`packages/orchestrator/src/index.ts`](packages/orchestrator/src/index.ts)
  - [`packages/orchestrator/src/pipeline.ts`](packages/orchestrator/src/pipeline.ts)
  - [`packages/orchestrator/src/manifest.ts`](packages/orchestrator/src/manifest.ts)
  - [`packages/orchestrator/src/observability.ts`](packages/orchestrator/src/observability.ts)
  - Adapter implementations under:
    - [`packages/orchestrator/src/adapters`](packages/orchestrator/src/adapters)

Contract:

- The orchestrator’s exported API is the primary, stable integration surface.
- Supporting packages are considered internal dependencies unless explicitly documented otherwise.
- Orchestrator is library-only (CLI/wizard/path-picker removed).
- Batch-backend is the operational runtime entrypoint.

#### 4.1.2. Key Exports and Contracts

Agents MUST treat the following as canonical:

- `createPipeline(options)`
  - Builds an `OrchestratorPipeline`.
  - Options include:
    - `cwd`
    - Config paths and adapter selection
    - `logger`, `metrics`, `manifestStore`, `configProvider`
- `resolveConfigPaths(options)`
  - Computes resolved presets/voices/students paths.
- `loadEnvFiles(options)`
  - Loads `.env` in a controlled way.
- `resolveManifestPath(mdPath)`
  - Deterministic manifest path for a given Markdown file.

Core types (names may vary; confirm via [`packages/orchestrator/src/pipeline.ts`](packages/orchestrator/src/pipeline.ts) / [`packages/orchestrator/src/index.ts`](packages/orchestrator/src/index.ts)):

- `CreatePipelineOptions`
- `OrchestratorPipeline`
- `PipelineNewAssignmentOptions`
- `PipelineRerunOptions`
- `AssignmentManifest`
- Adapter-related types:
  - `ConfigProvider`
  - `ManifestStore`
  - `PipelineLogger`
  - `PipelineMetrics`

Public adapter/utility exports (exact list from index.ts; agents MUST confirm):

- `createFilesystemManifestStore`
- `S3ManifestStore`
- `RemoteConfigProvider` (if exported)
- Filesystem-based `ConfigProvider` creator (if exported).
- `noopLogger`, `noopMetrics` or equivalents for default observability.

Rules:

- Agents MUST prefer using these exports directly.
- Agents MUST NOT copy-paste or re-implement internal orchestrator logic in other packages.

#### 4.1.3. Extension Points (Adapters and Observability)

Adapter concepts:

- `ManifestStore`:
  - Interface defined in [`packages/orchestrator/src/manifest.ts`](packages/orchestrator/src/manifest.ts).
  - Implementations:
    - Filesystem (default).
    - `S3ManifestStore` in [`packages/orchestrator/src/adapters/manifest/s3.ts`](packages/orchestrator/src/adapters/manifest/s3.ts).
- `ConfigProvider`:
  - Interface defined in orchestrator source (see `src/index.ts`/`src/pipeline.ts`).
  - Implementations:
    - Filesystem default.
    - Remote/HTTP-based config provider in [`packages/orchestrator/src/adapters/config/remote.ts`](packages/orchestrator/src/adapters/config/remote.ts).
- Observability:
  - `PipelineLogger`, `PipelineMetrics` interfaces and helpers in:
    - [`packages/orchestrator/src/observability.ts`](packages/orchestrator/src/observability.ts)

Where to add new adapters:

- Config providers:
  - [`packages/orchestrator/src/adapters/config`](packages/orchestrator/src/adapters/config)
- Manifest stores:
  - [`packages/orchestrator/src/adapters/manifest`](packages/orchestrator/src/adapters/manifest)

Adapter rules:

- New adapters MUST:
  - Fully implement the documented interface.
  - Be pluggable via:
    - `createPipeline` options, and/or
    - environment-variable-based selection implemented in orchestrator.
- MUST NOT:
  - Introduce ad-hoc globals.
  - Bypass existing selection patterns without updating this SSOT.

Roadmap-only constructs (e.g., `SecretProvider`, advanced tenant-aware providers) are “to be confirmed” and MUST NOT be assumed present until implemented.

#### 4.1.4. Ownership Boundary Rules (Orchestrator vs Batch Backend)

Boundary invariants:

- Canonical pipeline semantics (stage order, manifest semantics, rerun planner behavior) MUST remain owned by orchestrator.
- Backend worker/process lifecycle behavior (IPC, cancellation relay, worker fallback strategy) MUST remain owned by batch-backend.
- Shared helper logic duplicated across packages SHOULD be extracted into shared packages (for example `@esl-pipeline/shared-infrastructure`) when it is domain-neutral and reused by both sides.
- Agents MUST consult the active ownership ledger before moving behavior across package boundaries:
  - `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`

#### 4.1.5. Stage 1 Baseline Lock (Mandatory Before Further Refactor Stages)

Before entering Stage 2+ of the orchestrator library-only roadmap, agents MUST keep the Stage 1 characterization baseline green and unchanged in intent:

- `packages/orchestrator/tests/pipeline.integration.test.ts`
  - Canonical stage sequencing and callback status ordering for `newAssignment`.
- `packages/orchestrator/tests/index.test.ts`
  - Manifest lifecycle behavior (`newAssignment` write + rerun path semantics via `manifestMd`) and cancellation baseline.
- `packages/orchestrator/tests/observability.test.ts`
  - Stage/pipeline observability event naming and start/success/skipped patterns.
- `packages/batch-backend/tests/infrastructure.orchestrator-service.test.ts`
  - Backend->orchestrator boundary invocation, execution-mode payload shape, and abort relay behavior.

If any of these behaviors intentionally change, agents MUST:

1. Update the ownership ledger with rationale and migration path.
2. Update this SSOT section and relevant plan stage docs.
3. Treat compatibility impact under `docs/reference/VERSIONING_MODEL.md` before merge.

### 4.2. Supporting Packages (Per-Package Snapshots)

For each supporting package listed below, agents MUST treat the orchestrator as its primary consumer. Changes in these packages MUST be coordinated with orchestrator code and tests.

For all subsections:

- DO:
  - Add new capabilities in backward-compatible ways.
  - Keep exported signatures used by orchestrator stable.
- DO NOT:
  - Break orchestrator expectations silently.

#### 4.2.1. [`packages/md-validator`](packages/md-validator)

- Role:
  - Validate Markdown structure and ESL-pipeline-specific rules.
- Key APIs:
  - CLI in [`packages/md-validator/bin/cli.ts`](packages/md-validator/bin/cli.ts).
  - Library exports in [`packages/md-validator/src/index.ts`](packages/md-validator/src/index.ts) and [`validator.ts`](packages/md-validator/src/validator.ts).
- Contracts:
  - MUST produce deterministic validation results for orchestrator.
  - Output shapes relied upon by orchestrator MUST remain stable.
  - `validateMarkdown` input is backward-compatible and additive:
    - existing input forms (`path`, `markdown`, `context`) remain valid.
    - optional preset context is supported: `learningPresetId`, `learningPresetVersion`, and legacy `preset`.
  - Ruleset resolution is deterministic:
    - known `learningPresetId` resolves to mapped ruleset.
    - unknown `learningPresetId` falls back to `general-english@v1` with warning issue.
    - legacy `preset` maps to `general-english@v1`.
  - Response contract is additive:
    - legacy fields (`ok`, `errors`, `warnings`, `meta`, `voiceDiagnostics`) remain.
    - additive fields are optional: `issues`, `ruleset`.
- Safe extensions:
  - Adding new validation options is allowed if defaults remain backward compatible.

#### 4.2.2. [`packages/pmd`](packages/pmd)

- Role:
  - Parse Pipeline Markdown into a stable AST and extract study text/metadata.
- Key APIs:
  - Exports in [`packages/pmd/src/index.ts`](packages/pmd/src/index.ts).
- Contracts:
  - Output format consumed by downstream stages MUST remain stable.
- Safe extensions:
  - Additional metadata allowed if orchestrator either ignores or explicitly supports it.

#### 4.2.3. [`packages/notion-adapter`](packages/notion-adapter)

- Role:
  - Centralized Notion integration surface for the orchestrator.
  - Handles page creation/update, heading presets, and audio attachment.
- Contracts:
  - Orchestrator MUST call the adapter rather than re-implementing Notion workflows.
  - Adapter inputs/outputs are the stable integration surface; internal modules may evolve.
  - Frontmatter `properties` MUST already exist in the target database; unknown property names are a validation error (fail fast before calling Notion).
  - Topic handling is DB-driven: if a `Topic` property is missing or is `multi_select`, send multi-select (split by commas); otherwise send rich_text.
  - Advanced blocks MUST match Notion API schemas:
    - callout children inside `callout.children`
    - column lists under `column_list.column_list.children -> column.column.children`
    - toggle headings (`toggle-h1/h2/h3`) keep children under the heading payload
    - synced blocks use `synced_block.children` when creating new content; references use `synced_from`
    - tables put rows in `table.table.children`
    - list-item nesting stays under list-item payload (`bulleted_list_item.children`, `numbered_list_item.children`)
  - Audio attachment requires the uploaded audio URL and target Notion page.
- Safe extensions:
  - Add new adapter operations as long as existing orchestrator calls remain backward compatible.

#### 4.2.7. [`packages/tts-core`](packages/tts-core)

- Role:
  - Provider-agnostic TTS contracts, registry, and orchestration entrypoints.
- Contracts:
  - `TtsEngine` composes explicit providers and resolves `ttsProvider` deterministically.
  - Exposes shared manifest/result shapes consumed by orchestrator and batch surfaces.
- Safe extensions:
  - Add new providers via explicit adapter registration without branching inside core.

#### 4.2.8. [`packages/tts-provider-elevenlabs`](packages/tts-provider-elevenlabs) and [`packages/tts-provider-google`](packages/tts-provider-google)

- Role:
  - Provider-specific synthesis, voice catalog loading, assignment resolution, and diagnostics.
- Contracts:
  - Provider env keys are namespaced under `ESL_TTS_PROVIDER_<PROVIDER>_*`.
  - Provider adapters must return shared `BuildStudyTextResult` / `BuildPronunciationShadowSentenceResult` shapes.
- Safe extensions:
  - Provider-local model/voice expansion that preserves shared contracts.

#### 4.2.9. [`packages/storage-uploader`](packages/storage-uploader)

- Role:
  - Upload files (e.g., audio) to storage backends such as S3.
- Contracts:
  - Input: local file path, metadata.
  - Output: URLs and/or identifiers used by Notion and manifest.
- Safe extensions:
  - New backends allowed; orchestrator updates required to route to them.

#### 4.2.10. [`packages/shared-infrastructure`](packages/shared-infrastructure)

- Role:
  - Centralized infrastructure utilities shared between orchestrator and batch-backend.
  - Single source of truth for environment loading, storage configuration, and manifest resolution.
- Key exports:
  - Environment utilities (`src/env/loaders.ts`):
    - `loadEnvFiles(options)` - Load `.env` files from specified directories
    - `readBool(key, defaultValue)` - Parse boolean environment variables
    - `readInt(key, defaultValue)` - Parse integer environment variables
    - `readString(key, defaultValue)` - Read string environment variables
  - Storage configuration (`src/storage/config.ts`):
    - `StorageConfigurationService` - Resolves S3/MinIO/filesystem storage configurations
    - `createStorageConfigService(options)` - Factory function for storage config service
  - Manifest resolution (`src/storage/manifest-resolver.ts`):
    - `resolveManifestStoreConfig(options)` - Determines manifest store type and configuration
- Contracts:
  - MUST provide backward-compatible interfaces for orchestrator and batch-backend
  - Environment variable parsing MUST match legacy behavior exactly
  - Storage configuration resolution MUST support all existing backends (S3, MinIO, filesystem)
- Safe extensions:
  - New utility functions for infrastructure concerns
  - Additional storage backend support
  - Enhanced environment variable parsing (with backward compatibility)
- Migration notes:
  - As of Stage 5 (2025-11-21), both orchestrator and batch-backend import from this package
  - Orchestrator maintains backward-compatible re-exports for `loadEnvFiles`
  - Batch-backend imports `readBool`, `readInt`, `readString` directly
  - Eliminated ~250 lines of duplicated code across packages

---

## 5. Configuration, Secrets, and Adapters

### 5.1. Local Config Files

Local defaults live under [`packages/orchestrator/configs`](packages/orchestrator/configs):

- [`packages/orchestrator/configs/presets.json`](packages/orchestrator/configs/presets.json)
  - Defines pipeline presets (e.g., levels, behaviors).
- [`packages/orchestrator/configs/voices.yml`](packages/orchestrator/configs/voices.yml)
  - Maps voices to ElevenLabs or other TTS configuration.
- [`packages/orchestrator/configs/students/*.json`](packages/orchestrator/configs/students)
  - Per-student or profile configs.

`createPipeline` and `ConfigProvider` determine how these are loaded. Agents:

- MUST keep these files’ schemas consistent with orchestrator expectations.
- MUST update or add tests when changing schema or behavior.
- SHOULD treat changes as configuration-only; code changes go through orchestrator or adapters.

### 5.2. Environment-Based Configuration

Key environment variables controlling adapters and behavior (see [`README.md`](README.md) and the backend docs bundle, in order):

- [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md) - unified reference for the batch frontend and backend system.
- [`docs/backend-frontend/batch-backend-ssot.md`](docs/backend-frontend/batch-backend-ssot.md) - detailed backend internals and invariants.
- [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md) - API contract status and gap tracking.

Manifest store selection:

- `ESL_PIPELINE_MANIFEST_STORE`
  - `s3` selects S3-based manifest store.
- `ESL_PIPELINE_MANIFEST_BUCKET`
- `ESL_PIPELINE_MANIFEST_PREFIX` (optional)
- `ESL_PIPELINE_MANIFEST_ROOT` (optional)

Config provider selection:

- `ESL_PIPELINE_CONFIG_PROVIDER`
  - e.g., `http` for remote config.
- `ESL_PIPELINE_CONFIG_ENDPOINT`
- `ESL_PIPELINE_CONFIG_TOKEN`
- `ESL_PIPELINE_CONFIG_CACHE_TTL_MS` (optional; default `60000`)
- `ESL_PIPELINE_CONFIG_CACHE_STALE_IF_ERROR_MS` (optional; default `300000`)
- `ESL_PIPELINE_CONFIG_CONDITIONAL_REQUESTS` (optional; default `true`)
- Optional: paths for presets/students/voices endpoints.

Upload (S3) selection:

- `--upload s3` uses:
  - `S3_BUCKET` (required)
  - `S3_PREFIX` (optional key prefix)
  - `AWS_REGION` (for S3 client)
- Credentials rely on standard AWS env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
- Optional caching toggles (per-process, default off):
  - `ESL_PIPELINE_CACHE_ENV`: memoizes `.env` loading; invalidates on mtime/size change.
  - `ESL_PIPELINE_CACHE_CONFIG`: memoizes `resolveConfigPaths`; invalidates on mtime/size change of presets/voices/students or when inputs differ.

Mapping to behavior is implemented in:

- [`packages/orchestrator/src/pipeline.ts`](packages/orchestrator/src/pipeline.ts)
- [`packages/orchestrator/src/adapters/config/remote.ts`](packages/orchestrator/src/adapters/config/remote.ts)
- [`packages/orchestrator/src/adapters/manifest/s3.ts`](packages/orchestrator/src/adapters/manifest/s3.ts)
- [`packages/orchestrator/src/manifest.ts`](packages/orchestrator/src/manifest.ts)
- Uploads are performed via [`@esl-pipeline/storage-uploader`](packages/storage-uploader), which
  consumes the `S3_*` variables above.

Agents:

- MUST route new env-based behaviors through orchestrator selection logic.
- MUST document any new env variables here and in relevant docs.

### 5.3. Adapter Abstractions (ConfigProvider, ManifestStore, Secret Handling)

Interfaces:

- `ConfigProvider`
  - Responsible for:
    - Loading presets.
    - Loading student profiles.
    - Resolving voices configuration.
- `ManifestStore`
  - Responsible for:
    - `manifestPathFor(mdPath)`
    - `writeManifest(mdPath, manifest)`
    - `readManifest(mdPath)`

Custom implementations:

- MUST live under:
  - [`packages/orchestrator/src/adapters/config`](packages/orchestrator/src/adapters/config)
  - [`packages/orchestrator/src/adapters/manifest`](packages/orchestrator/src/adapters/manifest)
- MUST be wired via:
  - `createPipeline` options and/or
  - environment-variable strategy in orchestrator.

Secrets:

- MUST be injected via environment variables or host-level secret managers.
- Agents MUST NOT hardcode secrets or credentials.

SecretProvider and advanced patterns:

- Marked as “to be confirmed” in roadmap docs.
- MUST NOT be assumed until implemented in code and referenced here.

---

## 6. Manifests: Schema, Lifecycle, Storage, Compatibility

### 6.1. Manifest Schema Source of Truth

Manifest schema:

- Primary reference: [`docs/reference/pipeline-manifest.md`](docs/reference/pipeline-manifest.md).
  - Implementation: [`packages/orchestrator/src/manifest.ts`](packages/orchestrator/src/manifest.ts).
  - Contains:
    - `AssignmentManifest` type.
    - `CURRENT_MANIFEST_SCHEMA_VERSION`.
    - Filesystem-based `ManifestStore`.
    - Optional TTS metadata fields persisted alongside audio:
      - `ttsStrategy`, `dialogueLanguage`, `dialogueStability`, `dialogueSeed`.
    - Additive artifact identity/reuse metadata:
      - `audio.key`, `audio.etag`, `audio.sizeBytes`, `audio.reused`
      - `audioArtifacts.studyText.*` (multi-artifact map; compatibility alias to `audio`)
      - `audioArtifacts.pronunciationShadowSentence.*` (optional shadow-sentence reference audio)
      - `htmlHash`, `htmlKey`, `htmlEtag`, `htmlReused`
      - `notionColorization.preset`, `notionColorization.presetHash`, `notionColorization.pageId`, `notionColorization.mdHash`, `notionColorization.appliedAt`

Agents MUST:

- Treat `AssignmentManifest` and `CURRENT_MANIFEST_SCHEMA_VERSION` as authoritative.
- Ensure any change in manifest structure is reflected:
  - In the code.
  - In [`docs/reference/pipeline-manifest.md`](docs/reference/pipeline-manifest.md).
  - In this SSOT.

### 6.2. Lifecycle and Ownership

Manifest behavior:

- Creation:
  - `newAssignment` writes manifests via `ManifestStore`.
- Updates:
  - `rerunAssignment` reads and updates manifest.
  - `planRerunAssignment` reads manifest and computes executable rerun stages + prerequisites.
- Reads:
  - `getAssignmentStatus` reads manifest and summarizes status.

Default storage:

- Filesystem:
  - Manifests live next to the `.md` file as `.manifest.json`.
  - Implemented via `createFilesystemManifestStore` in [`packages/orchestrator/src/manifest.ts`](packages/orchestrator/src/manifest.ts).

Alternate storage:

- S3:
  - `S3ManifestStore` in [`packages/orchestrator/src/adapters/manifest/s3.ts`](packages/orchestrator/src/adapters/manifest/s3.ts).
  - Selected via environment variables or explicit `createPipeline` options.

Ownership:

- Orchestrator owns the manifest format and lifecycle.
- External services MUST treat manifests as opaque beyond documented schema.

### 6.3. Backwards Compatibility Rules

Rules:

- Additive changes:
  - MAY add new fields; readers MUST tolerate unknown fields.
- Breaking changes:
  - REQUIRE:
    - Incrementing `CURRENT_MANIFEST_SCHEMA_VERSION`.
    - Migration guidance in [`docs/reference/pipeline-manifest.md`](docs/reference/pipeline-manifest.md).
    - Coordinated orchestrator changes.
- MUST NOT:
  - Remove or rename existing fields without full migration strategy.
  - Write manifests without `schemaVersion` once versioning is established (legacy fallbacks handled in code).

Agents MUST keep manifest behavior backward compatible unless explicitly performing a coordinated breaking change.

---

## 7. Programmatic API: Contracts and Priorities

### 7.1. Operational Priority

- Batch-backend is the active operational runtime entrypoint.
- Orchestrator programmatic API is the canonical pipeline contract.
- Orchestrator ships as a library-only package (no CLI/wizard/path-picker surface).

### 7.2. Programmatic API as Source of Truth

Programmatic usage via `@esl-pipeline/orchestrator`:

- `createPipeline`
- `loadEnvFiles`
- `resolveConfigPaths`
- `resolveManifestPath`
- Additive v2 execution envelopes:
  - `executeNewAssignmentV2`
  - `executeRerunAssignmentV2`
  - `executeGetAssignmentStatusV2`
  - `executePlanRerunAssignmentV2`
- Manifest helpers and adapter types.

Contracts:

- Programmatic API is the primary behavioral source of truth.
- New behavior MUST land in pipeline/orchestrator first.
- Batch-backend runtime is cut over to v2 execution envelopes; v1 and v2 exports may coexist for compatibility until explicit major-stage removals.

Agents:

- MUST implement new semantics in orchestrator/core functions before any backend wiring changes.

---

## 8. Safety Rails and Forbidden Changes for Agents

### 8.1. Non-Negotiable Invariants

Agents MUST NOT:

- Change minimum Node version or core toolchain without:
  - Updating `package.json` engines.
  - Updating `.nvmrc`, CI workflows, README, and this SSOT.
- Break the pipeline stage order or semantics without coordinated updates.
- Alter manifest schema in incompatible ways (see section 6.3).
- Remove or silently change public orchestrator exports.
- Change environment variable names or meanings that users depend on.
- Remove ffmpeg/system requirements relied upon by TTS provider adapters.
- Violate ESM/TypeScript configurations that build requires.

### 8.2. Editing Rules for Agents

Agents SHOULD:

- Use targeted edits:
  - Prefer `apply_diff`/`insert_content` over blind rewrites.
- Locate ownership:
  - Determine which package “owns” a behavior before changes.
- Preserve existing abstractions:
  - Use adapters and injected dependencies (logger/metrics) instead of new globals.

Agents MUST NOT:

- Introduce new top-level CLIs or binaries without:
  - Clear justification.
  - Documentation updates (README + SSOT).
- Hardcode credentials or environment-specific paths.
- Introduce dependencies incompatible with Node/CI policies.

### 8.3. Cross-File Consistency Requirements

When changing:

- Pipeline behavior:
  - Update orchestrator tests and this SSOT.
- Manifests:
  - Update [`docs/reference/pipeline-manifest.md`](docs/reference/pipeline-manifest.md), orchestrator manifest code, and tests.
- Adapters or env toggles:
  - Update [`README.md`](README.md) and the backend docs bundle (in order):
    - [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md) - unified reference for the batch frontend and backend system.
    - [`docs/backend-frontend/batch-backend-ssot.md`](docs/backend-frontend/batch-backend-ssot.md) - detailed backend internals and invariants.
    - [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md) - API contract status and gap tracking.
- Agent guidance:
  - Update [`AGENTS.md`](AGENTS.md) if high-level narrative changes.

These are atomic, multi-file contracts. Partial updates are forbidden.

---

## 9. Workflow Playbooks for Common Tasks

Each subsection is a deterministic recipe to be followed exactly.

### 9.1. Add or Update a Preset

Steps:

1. Edit [`packages/orchestrator/configs/presets.json`](packages/orchestrator/configs/presets.json).
2. Ensure schema matches expectations in `ConfigProvider` and orchestrator.
3. Update tests/fixtures that depend on presets.
4. Verify via:
   - Orchestrator tests.
   - `pnpm smoke` (if applicable).

Constraints:

- Do not repurpose existing presets without considering breaking downstream users.

### 9.2. Add or Update Voices Mapping

Steps:

1. Edit [`packages/orchestrator/configs/voices.yml`](packages/orchestrator/configs/voices.yml).
2. Ensure compatibility with:
   - active TTS provider voice resolution (`tts-provider-elevenlabs` / `tts-provider-google`).
   - Any orchestrator logic that reads voices.
3. Run tests affecting TTS and voice resolution.

Constraints:

- MUST NOT break default voice behavior or cause missing mappings for existing presets.

### 9.3. Add or Update a Student Profile

Steps:

1. Add/modify JSON under [`packages/orchestrator/configs/students`](packages/orchestrator/configs/students).
2. Follow existing schema patterns.
3. If new shape is introduced, ensure:
   - ConfigProvider handles it.
   - Tests exist.

Constraints:

- Profiles MUST remain parseable and non-breaking to existing usage.
- Runtime student profiles are configuration objects (not pedagogical history blobs).
- `profileId` (when set) MUST be a normalized relative ID under the prompt profile root and use
  `.md` or `.txt`.
- Prompt package profile resolution precedence MUST remain:
  1. explicit `profileId`
  2. explicit `profilePath`
  3. student-linked `profileId`
  4. configured default profile

### 9.4. Add a New Manifest Backend

Steps:

1. Implement a new `ManifestStore` under:
   - [`packages/orchestrator/src/adapters/manifest`](packages/orchestrator/src/adapters/manifest)
2. Wire into:
   - `createPipeline` options in [`packages/orchestrator/src/pipeline.ts`](packages/orchestrator/src/pipeline.ts).
   - Optional environment selection logic.
3. Add tests:
   - Unit tests for the new store.
   - Integration tests showing orchestrator selecting and using it.
4. Update:
   - [`docs/reference/pipeline-manifest.md`](docs/reference/pipeline-manifest.md) if storage semantics impact usage.
   - [`README.md`](README.md) to document configuration.

Constraints:

- MUST maintain manifest schema and lifecycle guarantees.

### 9.5. Add a New Config Provider Backend

Steps:

1. Implement `ConfigProvider` under:
   - [`packages/orchestrator/src/adapters/config`](packages/orchestrator/src/adapters/config)
2. Expose via:
   - Orchestrator index if public.
   - `createPipeline` options and/or env toggles.
3. Add tests:
   - Provider behavior.
   - Orchestrator selection.

Update docs:

- [`README.md`](README.md)
- Backend docs bundle (in order):
  - [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md) - unified reference for the batch frontend and backend system.
  - [`docs/backend-frontend/batch-backend-ssot.md`](docs/backend-frontend/batch-backend-ssot.md) - detailed backend internals and invariants.
  - [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md) - API contract status and gap tracking.
- This SSOT if relevant.

### 9.6. CLI Surface Policy

Constraints:

- Do not add new orchestrator CLI flags.
- If an operator entrypoint is required, implement it in batch-backend surfaces and document it in backend docs.

### 9.7. Extend Observability (Logging/Metrics)

Steps:

1. Use interfaces in:
   - [`packages/orchestrator/src/observability.ts`](packages/orchestrator/src/observability.ts)
2. Add new log/metric fields in a backward-compatible way:
   - Avoid renaming existing keys used by external systems without coordination.
3. Document:
   - New events/metrics in relevant backend docs (and optionally here).

Constraints:

- Do not hardcode vendor-specific dependencies in core orchestrator.
- Keep observability pluggable.

### 9.8. Introduce a New Pipeline Stage (Advanced / To Be Confirmed)

This is a coordinated change that SHOULD be human-reviewed.

Required steps:

1. Define stage behavior and contracts.
2. Implement stage in orchestrator code:
   - Integrate into `newAssignment` / `rerunAssignment`.
3. Update:
   - Manifests if new durable data is produced (with schema versioning rules).
   - CLI flags if stage is user-controllable.
   - Tests across all affected packages.
   - This SSOT and other docs.

Agents MUST treat new stages as high-risk changes requiring explicit approval.

---

## 10. Testing, Linting, CI, and Release Contracts

### 10.1. Test Matrix

Essential commands:

- `pnpm lint`
- `pnpm test` (unit lane)
- `pnpm test:integration` (integration lane)
- `pnpm -r build`
- `pnpm --filter @esl-pipeline/orchestrator test`
- `pnpm smoke` or orchestrator smoke/integration tests
- Example/service tests under:
  - [`packages/orchestrator/examples/service`](packages/orchestrator/examples/service)

Any change affecting orchestrator behavior, manifests, or adapters MUST include/adjust tests accordingly.

### 10.2. CI Expectations

CI (see [`.github/workflows`](.github/workflows)):

- Runs on defined Node versions (including required Node 24.x).
- Builds orchestrator (and relevant packages).
- Runs tests and example service.

Agents MUST:

- Keep CI passing.
- Update CI config when runtime/tooling requirements change.

### 10.3. Release and Versioning Rules

Release model:

- Private monorepo; npm publishing is out of scope.
- Repo release version is merge-driven and tracked by:
  - Git tag `vX.Y.Z`.
  - Root [`package.json`](package.json) `version` (must match tag without `v`).
- Contract versions are centralized in:
  - [`packages/contracts/src/contract-versions.ts`](packages/contracts/src/contract-versions.ts)
- PRs targeting `main` MUST include exactly one release label:
  - `release:major`
  - `release:minor`
  - `release:patch`
- Release automation is implemented in:
  - [`.github/workflows/release-on-merge.yml`](.github/workflows/release-on-merge.yml)

Semver:

- Contract-first bump policy:
  - `major`: breaking contract compatibility.
  - `minor`: additive backward-compatible features.
  - `patch`: fixes/docs/ops/refactors without compatibility break.
- Breaking changes to:
  - Orchestrator API,
  - CLI behavior,
  - Manifest schema semantics,
  - Adapter selection semantics,
  REQUIRE:
  - appropriate release label selection and semver bump,
  - contract version updates where applicable,
  - documentation updates in:
    - [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md)
    - this SSOT.

---

## 11. Observability and Roadmap Awareness

### 11.1. Current Observability Contracts

Orchestrator supports injected:

- `PipelineLogger`
- `PipelineMetrics`

Agents SHOULD:

- Use these interfaces to emit:
  - Stage-level start/success/failure events.
  - Timings and counters keyed by stage and outcome.
- Keep event names stable once external systems rely on them.

If specific event naming patterns exist (e.g., `pipeline.newAssignment.*`, `stage.<name>.<status>`), they MUST be documented here and preserved. When adding new events, do so additively.

### 11.2. Future Extensions (To Be Confirmed)

Planned (see the backend docs bundle, in order):

- [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md) - unified reference for the batch frontend and backend system.
- [`docs/backend-frontend/batch-backend-ssot.md`](docs/backend-frontend/batch-backend-ssot.md) - detailed backend internals and invariants.
- [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md) - API contract status and gap tracking.

- Additional adapters (DB-backed stores, advanced config providers).
- Richer observability (e.g., tracing).
- Queue helpers and service scaffolding.

Rules:

- Agents MUST NOT assume roadmap items exist unless:
  - Implemented in code, and
  - Documented in this SSOT as implemented (without “to be confirmed”).

### 11.3. Voice Alignment V2 Contracts (Implemented)

This section is normative for current voice-alignment behavior.

1. Canonical frontmatter split:
   - `input_type`: source (`generate` | `authentic`)
   - `study_text_type`: structure (`monologue` | `dialogue`)
2. Validation diagnostics:
   - `MarkdownValidationResponse.voiceDiagnostics` is additive and optional.
   - `MarkdownValidationResponse.issues` and `MarkdownValidationResponse.ruleset` are additive and optional.
   - In compatibility mode (strict off), voice-alignment mismatches are warnings.
   - When `VOICE_ALIGNMENT_V2_ENABLED=true` and strict is off, `voiceDiagnostics.shadowMode`
     emits non-blocking mismatch classes and counts.
3. Strict behavior:
   - Strict validation is active only when both flags are on:
     - `VOICE_ALIGNMENT_V2_ENABLED=true`
     - `VOICE_ALIGNMENT_V2_STRICT_VALIDATION=true`
   - Strict mode promotes voice metadata mismatches to hard validation errors.
4. Prompt snapshot policy:
   - Default prompt remains `hw_prompt_v4-2_clean`.
   - `hw_prompt_v4-4_voice-aligned` is flag-gated (`VOICE_ALIGNMENT_V2_PROMPT=true`) and MUST be
     materialized with provider-backed capability enums from the current voice catalog snapshot.
   - Prompt package lineage MUST persist capability provenance metadata (`generatedAt` + hash).
5. Provider error normalization:
   - Provider-tagged errors (`[invalid_voice_id]`, `[unsupported_voice_capability]`,
     `[provider_rate_limit]`, `[provider_timeout]`, `[provider_contract_error]`) must map to
     structured job DTO/provider diagnostics where available.
6. Readiness metrics:
   - `/metrics/readiness` includes additive `voiceAlignment` counters.
   - Source-map metric keys include:
     - `voiceValidationFailureRate`
     - `voiceStrictMismatchRate`
     - `voiceFallbackRate`
     - `voiceProviderErrorRate`

---

## 12. Design Notes for Downstream Implementers (Human Maintainers)

### 12.1. How to Evolve This SSOT Safely

Any change affecting:

- Public orchestrator exports or behavior.
- CLI flags or semantics.
- Manifest schema or storage behavior.
- Adapters or environment selection.
- Observability event names or metric keys.

MUST:

1. Update `docs/reference/agents-ssot.md` (this file).
2. Update:
   - [`README.md`](README.md) for user-facing behavior.
   - [`docs/reference/pipeline-manifest.md`](docs/reference/pipeline-manifest.md) for manifest changes.
   - Backend docs bundle (in order):
     - [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md) - unified reference for the batch frontend and backend system.
     - [`docs/backend-frontend/batch-backend-ssot.md`](docs/backend-frontend/batch-backend-ssot.md) - detailed backend internals and invariants.
     - [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md) - API contract status and gap tracking.
   - [`AGENTS.md`](AGENTS.md) if high-level architecture guidance changes.
3. Include these doc updates in the same PR as code changes.

Treat this SSOT as part of the public API for automation.

### 12.2. Change Management Rules for Automation Dependence

When editing this file:

- Use concise, unambiguous language suited for parsing.
- Keep section and heading structure stable where possible.
- Maintain explicit MUST/SHOULD/MUST NOT semantics.
- For planned but unimplemented features:
  - Mark clearly as “to be confirmed.”
  - Remove that label only once code, tests, and docs exist.

If moving/renaming this file:

- Update all references in:
  - CI/scripts.
  - `AGENTS.md`.
  - Any automation that consumes it.
- Provide a redirect note at its previous location if retained.

### 12.3. Source of Truth Hierarchy

For automation and authoritative guidance, the precedence order is:

1. `docs/reference/agents-ssot.md` (this file)
2. Orchestrator code and exported types:
   - [`packages/orchestrator/src`](packages/orchestrator/src)
3. [`docs/reference/pipeline-manifest.md`](docs/reference/pipeline-manifest.md)
4. Backend docs bundle (read together, in order):
   - [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md) - unified reference for the batch frontend and backend system.
   - [`docs/backend-frontend/batch-backend-ssot.md`](docs/backend-frontend/batch-backend-ssot.md) - detailed backend internals and invariants.
   - [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md) - API contract status and gap tracking.
5. [`README.md`](README.md) and [`AGENTS.md`](AGENTS.md) and other human-facing docs

Maintainers MUST preserve this hierarchy when editing documentation and code.
