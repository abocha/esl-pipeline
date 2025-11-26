# ESL Pipeline Agent Handbook (SSOT)

Authoritative instructions for AI agents and maintainers operating in this repo.

This document is the machine-consumable Single Source of Truth (SSOT) for how to reason about, modify, and extend the ESL Pipeline monorepo. It encodes contracts, invariants, extension points, and workflows. Automated agents MUST treat this file as higher priority than general-purpose documentation when instructions conflict.

If any statement here conflicts with guidance in [`AGENTS.md`](AGENTS.md) or [`README.md`](README.md), this document wins for automation.

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
  - Primary entry point (CLI and programmatic API).
- [`packages/shared-infrastructure`](packages/shared-infrastructure)
  - Shared infrastructure utilities for environment loading, storage configuration, and manifest resolution.
- [`packages/md-validator`](packages/md-validator)
  - Markdown validation.
- [`packages/md-extractor`](packages/md-extractor)
  - Study text extraction from Markdown.
- [`packages/notion-importer`](packages/notion-importer)
  - Notion page creation and data source resolution.
- [`packages/notion-colorizer`](packages/notion-colorizer)
  - Heading/preset colorization in Notion.
- [`packages/notion-color-headings`](packages/notion-color-headings)
  - Legacy color-heading helper not wired into the orchestrator; treat as deprecated/for reference only.
- [`packages/notion-add-audio`](packages/notion-add-audio)
  - Attach audio to Notion content.
- [`packages/tts-elevenlabs`](packages/tts-elevenlabs)
  - ElevenLabs TTS integration (uses system `ffmpeg`).
- [`packages/storage-uploader`](packages/storage-uploader)
  - File upload (e.g. S3); used by orchestrator.
- [`configs`](configs)
  - Default presets, voices, student configs.
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
   - Uses [`packages/md-extractor`](packages/md-extractor).
3. Notion import
   - Uses [`packages/notion-importer`](packages/notion-importer) to create/update Notion pages.
4. Heading/styling colorization
   - Uses [`packages/notion-colorizer`](packages/notion-colorizer).
5. Text-to-speech (TTS) generation
   - Uses [`packages/tts-elevenlabs`](packages/tts-elevenlabs) with system `ffmpeg`.
6. Upload/storage
   - Uses [`packages/storage-uploader`](packages/storage-uploader) (e.g., S3).
7. Attach audio in Notion
   - Uses [`packages/notion-add-audio`](packages/notion-add-audio).
8. Manifest persistence
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
  -> colorize headings
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
  - Ownership: caller; validated by `md-validator` and read by `md-extractor`.
- Notion page(s)
  - Ownership: external Notion workspace.
  - Managed via `notion-importer`, `notion-colorizer`, `notion-add-audio`.
- Audio files
  - Local temporary output + remote URLs (e.g., S3).
  - Owned by `tts-elevenlabs` + `storage-uploader`.
- Assignment manifest
  - Canonical record of the pipeline run.
  - Schema documented in [`docs/pipeline-manifest.md`](docs/pipeline-manifest.md).
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
  - Required by `tts-elevenlabs`.
- Module system:
  - ESM/modern TypeScript targets as configured in `tsconfig` files.

Verification commands (MUST pass before merging behavior changes):

- `pnpm install`
- `pnpm -r build`
- `pnpm lint`
- `pnpm test`
- `pnpm smoke` (or equivalent orchestrator smoke/integration suite)
- Dependency alignment:
  - `pnpm deps:pin` — normalize shared versions (AWS SDK, Notion, ElevenLabs, React/Vite, Fastify/pg/Redis/bullmq, etc.).
  - `pnpm deps:upgrade:safe` — upgrade allowlisted SDKs (Notion/ElevenLabs/AWS S3) and stable utilities (axios/remark/unified/commander/ora/picocolors; extras via `SAFE_UPGRADE_EXTRA`), then reapply pins.

CI workflows under [`.github/workflows`](.github/workflows) encode required checks; agents MUST keep them green or update them explicitly when compatibility changes.

### 3.2. Environment Loading

Environment handling:

- CLI:
  - Auto-loads `.env` files from:
    - Repo root.
    - Current working directory (CWD).
  - Behavior documented in [`README.md`](README.md) and implemented via helpers in:
    - [`packages/orchestrator/src/index.ts`](packages/orchestrator/src/index.ts)
    - [`loadEnvFiles.declaration()`](packages/orchestrator/src/index.ts)
- Programmatic API:
  - `loadEnvFiles` mirrors CLI behavior for consumers.
  - Agents SHOULD use `loadEnvFiles` rather than reimplementing env loading.

Required/commonly used environment variables (non-exhaustive; see README/backends docs):

- Notion:
  - `NOTION_TOKEN`
- ElevenLabs:
  - `ELEVENLABS_API_KEY`
- AWS / storage:
  - `AWS_REGION`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - Optional manifest configuration vars (see section 5.2).
- Config/manifest adapters:
  - See section 5.2 and [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md).

Agents:

- MUST NOT hardcode secrets.
- SHOULD model new configuration via environment variables or adapter options, consistent with existing patterns.

---

## 4. Package-by-Package Responsibilities and Extension Points

This section defines what each package owns, which exports are stable, and how to extend safely.

### 4.1. Orchestrator Package (Core)

#### 4.1.1. Role

[`packages/orchestrator`](packages/orchestrator):

- Hosts the CLI:
  - [`packages/orchestrator/bin/cli.ts`](packages/orchestrator/bin/cli.ts)
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
- CLI behavior MUST be a thin, faithful wrapper around orchestrator functions.

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
- Safe extensions:
  - Adding new validation options is allowed if defaults remain backward compatible.

#### 4.2.2. [`packages/md-extractor`](packages/md-extractor)

- Role:
  - Extract study text and relevant content from validated Markdown.
- Key APIs:
  - Exports in [`packages/md-extractor/src/index.ts`](packages/md-extractor/src/index.ts).
- Contracts:
  - Output format consumed by downstream stages MUST remain stable.
- Safe extensions:
  - Additional metadata allowed if orchestrator either ignores or explicitly supports it.

#### 4.2.3. [`packages/notion-importer`](packages/notion-importer)

- Role:
  - Create/update Notion pages; manage hierarchy and sources.
- Contracts:
  - Input from extractor and config; output Notion references consumed later.
  - Frontmatter `properties` MUST already exist in the target database; unknown property names are a validation error (fail fast before calling Notion).
  - Topic handling is DB-driven: if a `Topic` property is missing or is `multi_select`, send multi-select (split by commas); otherwise send rich_text.
  - Advanced blocks MUST match Notion API schemas:
    - callout children inside `callout.children`
    - column lists under `column_list.column_list.children -> column.column.children`
    - toggle headings (`toggle-h1/h2/h3`) keep children under the heading payload
    - synced blocks use `synced_block.children` when creating new content; references use `synced_from`
    - tables put rows in `table.table.children`
    - list-item nesting stays under list-item payload (`bulleted_list_item.children`, `numbered_list_item.children`)
- Safe extensions:
  - New options that do not break existing orchestrator calls.

#### 4.2.4. [`packages/notion-colorizer`](packages/notion-colorizer)

- Role:
  - Apply heading/preset styling to Notion blocks.
- Contracts:
  - Must accept and transform blocks in a stable format.
- Safe extensions:
  - Additional presets or styles as long as existing presets remain valid.

#### 4.2.5. [`packages/notion-add-audio`](packages/notion-add-audio)

- Role:
  - Attach or update audio blocks in Notion based on uploaded files.
- Contracts:
  - Input: Notion page and audio URLs from uploader.
- Safe extensions:
  - Support for new audio layouts without breaking existing ones.

#### 4.2.6. [`packages/tts-elevenlabs`](packages/tts-elevenlabs)

- Role:
  - Integrate with ElevenLabs to produce audio files.
- Contracts:
  - Requires valid ElevenLabs credentials and ffmpeg.
  - Produces file paths/metadata used by uploader and manifest.
- Safe extensions:
  - Additional voices/options; MUST NOT break default voice behavior.

#### 4.2.7. [`packages/storage-uploader`](packages/storage-uploader)

- Role:
  - Upload files (e.g., audio) to storage backends such as S3.
- Contracts:
  - Input: local file path, metadata.
  - Output: URLs and/or identifiers used by Notion and manifest.
- Safe extensions:
  - New backends allowed; orchestrator updates required to route to them.

#### 4.2.8. [`packages/shared-infrastructure`](packages/shared-infrastructure)

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

Local defaults live under [`configs`](configs):

- [`configs/presets.json`](configs/presets.json)
  - Defines pipeline presets (e.g., levels, behaviors).
- [`configs/voices.yml`](configs/voices.yml)
  - Maps voices to ElevenLabs or other TTS configuration.
- [`configs/students/*.json`](configs/students)
  - Per-student or profile configs.
- [`configs/wizard.defaults.json`](configs/wizard.defaults.json)
  - Stores interactive wizard preferences (e.g., `withTts`, upload target).
  - Resolved via `wizardDefaultsPath` from [`resolveConfigPaths.declaration()`](packages/orchestrator/src/pipeline.ts:34), which binds it to the same `configRoot` as presets.

`createPipeline` and `ConfigProvider` determine how these are loaded. Agents:

- MUST keep these files’ schemas consistent with orchestrator expectations.
- MUST update or add tests when changing schema or behavior.
- SHOULD treat changes as configuration-only; code changes go through orchestrator or adapters.

### 5.2. Environment-Based Configuration

Key environment variables controlling adapters and behavior (see [`README.md`](README.md) and [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md)):

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
- Optional: paths for presets/students/voices endpoints.

Upload (S3) selection:

- `--upload s3` uses:
  - `S3_BUCKET` (required)
  - `S3_PREFIX` (optional key prefix)
  - `AWS_REGION` (for S3 client)
- Credentials rely on standard AWS env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

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

- Primary reference: [`docs/pipeline-manifest.md`](docs/pipeline-manifest.md).
- Implementation: [`packages/orchestrator/src/manifest.ts`](packages/orchestrator/src/manifest.ts).
  - Contains:
    - `AssignmentManifest` type.
    - `CURRENT_MANIFEST_SCHEMA_VERSION`.
    - Filesystem-based `ManifestStore`.
    - Optional TTS metadata fields persisted alongside audio:
      - `ttsMode`, `dialogueLanguage`, `dialogueStability`, `dialogueSeed`.

Agents MUST:

- Treat `AssignmentManifest` and `CURRENT_MANIFEST_SCHEMA_VERSION` as authoritative.
- Ensure any change in manifest structure is reflected:
  - In the code.
  - In [`docs/pipeline-manifest.md`](docs/pipeline-manifest.md).
  - In this SSOT.

### 6.2. Lifecycle and Ownership

Manifest behavior:

- Creation:
  - `newAssignment` writes manifests via `ManifestStore`.
- Updates:
  - `rerunAssignment` reads and updates manifest.
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
    - Migration guidance in [`docs/pipeline-manifest.md`](docs/pipeline-manifest.md).
    - Coordinated orchestrator changes.
- MUST NOT:
  - Remove or rename existing fields without full migration strategy.
  - Write manifests without `schemaVersion` once versioning is established (legacy fallbacks handled in code).

Agents MUST keep manifest behavior backward compatible unless explicitly performing a coordinated breaking change.

---

## 7. CLI vs Programmatic API: Contracts and Priorities

### 7.1. CLI Entry Points

CLI implementation:

- [`packages/orchestrator/bin/cli.ts`](packages/orchestrator/bin/cli.ts)

Canonical commands (names/flags verified from CLI implementation):

- `esl --md <file>`:
  - Run full pipeline for given Markdown.
- `esl status ...`:
  - Inspect manifest/pipeline status.
- `esl rerun ...`:
  - Rerun with updated options based on existing manifest.
- `esl select ...`:
  - Select runs or presets (per CLI implementation).
- `esl --version`:
  - Print version.

Rules:

- CLI is a thin adapter over orchestrator API.
- Any CLI feature MUST delegate to orchestrator exports, NOT duplicate logic.
- `--with-tts` is an explicit opt-in. When omitted, the orchestrator treats `withTts` as “no override” so that saved defaults from [`wizard.defaults.json`](configs/wizard.defaults.json) or other configuration can apply.

### 7.2. Programmatic API as Source of Truth

Programmatic usage via `@esl-pipeline/orchestrator`:

- `createPipeline`
- `loadEnvFiles`
- `resolveConfigPaths`
- `resolveManifestPath`
- Manifest helpers and adapter types.

Contracts:

- Programmatic API is the primary behavioral source of truth.
- New behavior MUST:
  - Land in pipeline/orchestrator first.
  - Then be exposed via CLI as needed.

Agents:

- MUST implement new semantics in orchestrator/core functions before wiring CLI.
- MUST NOT embed pipeline logic directly in CLI argument handlers.

### 7.3. Compatibility and Zero-Install Usage

Zero-install usage:

- `npx @esl-pipeline/orchestrator esl --help` (per README).

Constraints:

- Renaming binaries (e.g., `esl`) or changing command semantics is a breaking change.
- Such changes REQUIRE:
  - Semver update.
  - README/SSOT updates.
  - Migration notes.

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
- Remove ffmpeg/system requirements relied upon by `tts-elevenlabs`.
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
  - Update [`docs/pipeline-manifest.md`](docs/pipeline-manifest.md), orchestrator manifest code, and tests.
- Adapters or env toggles:
  - Update [`README.md`](README.md) and [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md).
- Agent guidance:
  - Update [`AGENTS.md`](AGENTS.md) if high-level narrative changes.

These are atomic, multi-file contracts. Partial updates are forbidden.

---

## 9. Workflow Playbooks for Common Tasks

Each subsection is a deterministic recipe to be followed exactly.

### 9.1. Add or Update a Preset

Steps:

1. Edit [`configs/presets.json`](configs/presets.json).
2. Ensure schema matches expectations in `ConfigProvider` and orchestrator.
3. Update tests/fixtures that depend on presets.
4. Verify via:
   - Orchestrator tests.
   - `pnpm smoke` (if applicable).

Constraints:

- Do not repurpose existing presets without considering breaking downstream users.

### 9.2. Add or Update Voices Mapping

Steps:

1. Edit [`configs/voices.yml`](configs/voices.yml).
2. Ensure compatibility with:
   - `tts-elevenlabs` voice resolution.
   - Any orchestrator logic that reads voices.
3. Run tests affecting TTS and voice resolution.

Constraints:

- MUST NOT break default voice behavior or cause missing mappings for existing presets.

### 9.3. Add or Update a Student Profile

Steps:

1. Add/modify JSON under [`configs/students`](configs/students).
2. Follow existing schema patterns.
3. If new shape is introduced, ensure:
   - ConfigProvider handles it.
   - Tests exist.

Constraints:

- Profiles MUST remain parseable and non-breaking to existing usage.

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
   - [`docs/pipeline-manifest.md`](docs/pipeline-manifest.md) if storage semantics impact usage.
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
- [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md)
- This SSOT if relevant.

### 9.6. Add a New CLI Flag

Steps:

1. Extend pipeline/orchestrator options:
   - Modify relevant types and handling in [`packages/orchestrator/src/pipeline.ts`](packages/orchestrator/src/pipeline.ts) and/or [`packages/orchestrator/src/index.ts`](packages/orchestrator/src/index.ts).
2. Wire flag in CLI:
   - Update [`packages/orchestrator/bin/cli.ts`](packages/orchestrator/bin/cli.ts).
3. Update docs:
   - CLI usage in [`README.md`](README.md).
   - This SSOT if behavior is part of core contracts.
4. Add tests:
   - CLI parsing.
   - Pipeline integration.

Constraints:

- CLI flags MUST reflect existing or newly added orchestrator options; no CLI-only logic.

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
- `pnpm test`
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

- Uses Changesets (see:
  - [`CHANGELOG.md`](CHANGELOG.md)
  - [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Publicly published package:
  - `@esl-pipeline/orchestrator`
- Other packages:
  - Treated as internal unless explicitly declared public.

Semver:

- Breaking changes to:
  - Orchestrator API,
  - CLI behavior,
  - Manifest schema,
  - Adapter selection semantics,
    REQUIRE:
  - Appropriate version bump.
  - Documentation of changes here and in relevant docs.

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

Planned (see [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md)):

- Additional adapters (DB-backed stores, advanced config providers).
- Richer observability (e.g., tracing).
- Queue helpers and service scaffolding.

Rules:

- Agents MUST NOT assume roadmap items exist unless:
  - Implemented in code, and
  - Documented in this SSOT as implemented (without “to be confirmed”).

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

1. Update `docs/agents-ssot.md` (this file).
2. Update:
   - [`README.md`](README.md) for user-facing behavior.
   - [`docs/pipeline-manifest.md`](docs/pipeline-manifest.md) for manifest changes.
   - [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md) for backend scaffolding.
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

1. `docs/agents-ssot.md` (this file)
2. Orchestrator code and exported types:
   - [`packages/orchestrator/src`](packages/orchestrator/src)
3. [`docs/pipeline-manifest.md`](docs/pipeline-manifest.md)
4. [`docs/groundwork-for-backend.md`](docs/groundwork-for-backend.md)
5. [`README.md`](README.md) and [`AGENTS.md`](AGENTS.md) and other human-facing docs

Maintainers MUST preserve this hierarchy when editing documentation and code.
