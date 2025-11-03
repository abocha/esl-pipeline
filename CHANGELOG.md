# Changelog

All notable changes to this project will be documented here. Dates use `YYYY-MM-DD`.

## [1.7.0] - 2025-11-01

### Phase 5 · Testing & Docs

- Hardened remote adapter documentation across the README and `docs/groundwork-for-backend.md`, capturing filesystem vs. HTTP configs and the S3 manifest store mock coverage.
- CI now mirrors the full release path: it builds the orchestrator Docker image (`pnpm --filter @esl-pipeline/orchestrator docker:build`) and runs the Fastify example service tests (`pnpm --filter @esl-pipeline/orchestrator/examples/service vitest run`).
- Introduced release automation scaffolding (Changesets, publish workflow, CONTRIBUTING checklist) so version bumps and npm publishes follow a predictable script.

### Added

- Pipeline integration tests covering filesystem vs. HTTP config providers and the S3 manifest store (mocked end-to-end).
- Documented Docker build/run workflow (`pnpm --filter @esl-pipeline/orchestrator docker:build` / `docker run --rm esl-pipeline/orchestrator:local --version`).
- Fastify example service README/test updates that spell out the dry-run job flow and workspace `PIPELINE_CWD` usage.
- Remote adapter environment variable reference for HTTP configs and S3 manifests in the main README.

### Changed

- Retired the legacy `esl-orchestrator` binary; use the primary `esl` command (via `npx --yes --package @esl-pipeline/orchestrator -- esl …`).

### Release Notes Template

Use this scaffold when cutting a new version (see `CONTRIBUTING.md` for the full release process):

```
## [X.Y.Z] - YYYY-MM-DD

### Highlights
- …

### Added
- …

### Changed
- …

### Fixed
- …

### Docs
- …
```

## [1.6.0] - 2025-10-31

### Added

- Orchestrator now builds as a single publishable CLI (`esl`) with an `npx @esl-pipeline/orchestrator` entry point.
- Bundled `dist/configs/` and `.env.example` inside the npm tarball so fresh installs have presets, student templates, and voice hints ready to go.
- Tests document the new ffmpeg resolver behaviour and enforce the flush-left `:::study-text` validation rule across fixtures.

### Changed

- Switched the orchestrator build to `tsup` (Node 24 target) plus a declaration-only TypeScript pass, shrinking the npm payload and inlining all workspace packages.
- Raised the required runtime to Node.js 24.10.0 and removed the vendored ffmpeg archive in favour of resolving a system installation (`ffmpeg` on PATH or `FFMPEG_PATH`).
- Documentation now highlights the `esl` command, the `npx` workflow, and the requirement to install ffmpeg manually.

### Added

- Bundled `Default` student profile keeps shared color defaults, and a new `--accent` flag lets ad-hoc runs request British/American voices without editing YAML (accent hints remain optional).
- Wizard/CLI fall back to profile presets even when you skip selecting a learner, keeping database and styling details consistent out of the box.
- Saved defaults live in `configs/wizard.defaults.json`; the wizard now labels `.env`-sourced values and only persists manually configured settings when you choose "Saved defaults…".
- Interactive wizard now starts with a menu (Start, Settings, quick preset) so tutors can run with defaults or tweak flags individually without replaying the full prompt sequence.
- Manual markdown picker supports tab-style autocompletion and includes an explicit Cancel option so you can back out without aborting the wizard.

### Changed

- Student profiles no longer force an accent hint; `accentPreference` now defaults to `null` so tutors opt in only when needed.
- Documentation clarifies when to set `pageParentId` versus using the database ID, and how accent preferences cascade through the pipeline.
- Markdown validator now enforces that the `:::study-text` marker and its closing `:::` start at column 1, preventing Notion imports from skipping the study-text toggle due to indentation.

## [1.3.0] - 2025-10-29

### Added

- Orchestrator now surfaces voice assignments in both JSON events and CLI summaries, making it clear which ElevenLabs voices were chosen for each speaker.
- Manifests persist the selected voice metadata so reruns and downstream tooling can reuse or audit previous choices.
- Bundled `Default` student profile keeps shared color defaults, and a new `--accent` flag lets ad‑hoc runs request British/American voices without editing YAML (accent hints remain optional).

### Changed

- Voice selection honours speaker `gender` metadata as a hard requirement and falls back only when no catalog match exists, eliminating accidental neutral voices.
- The TTS package locates front matter even when Markdown is wrapped in a fenced code block, ensuring speaker profiles are consistently detected.
- ffmpeg output is suppressed during successful runs; logs now surface only on failures to keep orchestrator output concise.
- Markdown validator accepts inline labels after `:::study-text`, matching how other toggle markers behave.

### Added

- Orchestrator logs the loaded `NOTION_TOKEN` (masked by default, plain text behind `ORCHESTRATOR_DEBUG_SECRETS`) so misconfigured environments are easy to spot.
- Build output now includes per-package declaration files and dedicated CLI bundles (e.g. `@esl-pipeline/md-validator` gained `dist/cli.js`), ensuring downstream TypeScript consumers get accurate typings.

### Changed

- Student linking is now best-effort: if the Notion importer cannot resolve a student page, the pipeline continues without failing but surfaces a warning and reports the linkage outcome in stage events.
- Workspace TypeScript configs were tightened to rely on the hoisted linker, consolidated path resolution, and the ffmpeg helper package aligned with the shared build strategy.

## [1.2.0] - 2025-10-28

## [1.1.0] - 2025-10-27

### Added

- All CLI entry points now auto-load `.env` via `dotenv/config`, so orchestrator, importer, and helper tools pick up credentials without manual `source` steps.
- Quick start docs highlight the interactive wizard as the fastest way to run the pipeline.
- Interactive orchestrator wizard now streams step-by-step progress with a spinner and prints a richer recap (deliverables, next steps) at the end.

### Changed

- The interactive wizard prompts for the Notion database immediately after student selection, using `NOTION_DB_ID` as the default.

## [1.0.0] - 2025-10-27

### Highlights

- **Rich Markdown to Notion mapping.** Bold, italic, inline code (rendered red), strikethrough, nested bullet hierarchies, indented paragraphs, and headings inside toggles now round-trip from Markdown into Notion rich text automatically. YAML frontmatter is skipped entirely.
- **Toggle-aware styling.** Toggle bodies reuse the Markdown parser so inner `###` headings pick up preset colouring and internal lists stay nested.
- **Audio placement fix.** ElevenLabs audio blocks are inserted above the `study-text` toggle instead of inside it. Existing audio is replaced only when requested.
- **Release hygiene.** Added a canonical publishing checklist and this changelog to support tagged releases.

### Other Improvements

- Tightened tests across the Notion importer, colorizer, and audio packages.
- Cleaned up documentation for environment setup, presets, and orchestrator workflows.
- Interactive wizard now defaults to the `NOTION_DB_ID` environment variable (prompted immediately after student selection) and still allows custom database input.
