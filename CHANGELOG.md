# Changelog

All notable changes to this project will be documented here. Dates use `YYYY-MM-DD`.

## [1.2.0] - 2025-10-28

## [1.4.0] - 2025-10-30

### Added

- Bundled `Default` student profile keeps shared color defaults, and a new `--accent` flag lets ad-hoc runs request British/American voices without editing YAML (accent hints remain optional).
- Wizard/CLI fall back to profile presets even when you skip selecting a learner, keeping database and styling details consistent out of the box.

### Changed

- Student profiles no longer force an accent hint; `accentPreference` now defaults to `null` so tutors opt in only when needed.
- Documentation clarifies when to set `pageParentId` versus using the database ID, and how accent preferences cascade through the pipeline.

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
