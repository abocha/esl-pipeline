# Repository Guidelines

## Project Structure & Module Organization
The workspace is managed with pnpm, and every functional unit sits in `packages/<module>`. Core pipelines include `md-extractor`, `md-validator`, `notion-importer`, `notion-styler`, `storage-uploader`, and `tts-elevenlabs`; cross-cutting helpers live in `packages/shared`. Source TypeScript lives in each package’s `src/` directory, compiled output in `dist/`, and runnable CLIs under `bin/`. Tests and fixtures stay alongside the package in `tests/`. Configuration assets (voice presets, student lists) are under `configs/`, while AWS credentials and bucket metadata must remain in a local `.env` file.

## Build, Test, and Development Commands
- `pnpm install` – install workspace dependencies; run once after cloning.
- `pnpm build` – run `tsc` across every package and refresh `dist/`.
- `pnpm test` / `pnpm test:watch` – execute all Vitest suites once or in watch mode.
- `pnpm --filter @esl-pipeline/md-extractor dev` – start a package-specific watch/CLI loop via `tsx`.
- `pnpm md-extractor` / `pnpm notion-importer` – invoke the built CLIs from the repo root.

## Coding Style & Naming Conventions
Code is modern TypeScript using ES modules. Prefer 2-space indentation, trailing commas, and descriptive, camelCase identifiers; exported types use PascalCase. Keep modules small, default to named exports, and co-locate helper types in `types.ts`. Run `pnpm build` after edits to ensure `tsc` emits clean `.d.ts` files.

## Testing Guidelines
Use Vitest for unit and integration coverage. Place new specs in `packages/<module>/tests` with filenames like `feature-name.test.ts`. Mirror the CLI contract in tests by exercising both happy paths and error handling. Run the relevant `pnpm --filter <module> test` while iterating, then `pnpm test` before pushing.

## Commit & Pull Request Guidelines
History favors short, imperative commits (e.g., `add md-extractor`, `init pipeline`). Keep messages under ~72 characters and group related changes together. Pull requests should describe the workflow impact, link to any Notion task or GitHub issue, and include CLI/test output when behavior changes. Request review once the branch builds cleanly and Vitest passes.

## Configuration & Security Tips
Never commit `.env`; load it per session with `set -a && source .env`. Validate S3 settings against `configs/presets.json` before uploading audio, and reference `configs/voices.yml` when adding narrators. Treat generated media and exports as disposable artifacts—keep only source Markdown and configuration under version control.
