# Orchestrator Dependency Audit (2026-02-06)

This document records the evidence-backed dependency audit for `@esl-pipeline/orchestrator`.

## Scope

- Package: `packages/orchestrator`
- Goal: keep only dependencies required for packaged runtime behavior.
- Build behavior note: `tsup` bundles internal `@esl-pipeline/*` modules (`noExternal`), but keeps third-party imports external.

## Evidence Method

For each runtime dependency:

1. Checked direct imports in `packages/orchestrator/src` and `packages/orchestrator/bin`.
2. Checked emitted imports in `packages/orchestrator/dist/index.js` and `packages/orchestrator/dist/cli.js`.
3. Traced transitive usage from bundled internal packages.
4. Verified packaged-runtime behavior by:
   - `pnpm --filter @esl-pipeline/orchestrator pack --pack-destination <tmp>`
   - installing tarball in a clean temp project with `npm install --omit=dev`
   - validating `import('@esl-pipeline/orchestrator')` and `esl --version`.

## Findings Matrix

| Dependency                  | Direct In `orchestrator/src`        | Transitive Via Bundled Internal Packages      | Present In `dist/*.js` Imports | Action |
| --------------------------- | ----------------------------------- | --------------------------------------------- | ------------------------------ | ------ |
| `@aws-sdk/client-s3`        | Yes (`src/adapters/manifest/s3.ts`) | Also via `storage-uploader`                   | Yes                            | Keep   |
| `@notionhq/client`          | No                                  | Yes (`notion-adapter`)                        | Yes                            | Keep   |
| `@elevenlabs/elevenlabs-js` | No                                  | Yes (`tts-elevenlabs`)                        | Yes                            | Keep   |
| `gray-matter`               | No                                  | Yes (`pmd`, `md-validator`, `notion-adapter`) | Yes                            | Keep   |
| `js-yaml`                   | No                                  | Yes (`tts-elevenlabs`)                        | Yes                            | Keep   |
| `remark-parse`              | No                                  | Yes (`pmd`)                                   | Yes                            | Keep   |
| `unified`                   | No                                  | Yes (`pmd`)                                   | Yes                            | Keep   |
| `zod`                       | No                                  | Yes (`md-validator`, `notion-adapter`)        | Yes                            | Keep   |

## Packaging Correction Applied

The following internal workspace packages were moved from runtime `dependencies` to `devDependencies` in `packages/orchestrator/package.json`:

- `@esl-pipeline/anytype-adapter`
- `@esl-pipeline/notion-adapter`
- `@esl-pipeline/shared-infrastructure`

Reason: internal packages are bundled into `dist` and are not runtime imports in emitted files. Keeping them in runtime deps made packed installation try to resolve unpublished internal packages.

## Operational Rule

When auditing `@esl-pipeline/orchestrator`:

- Runtime `dependencies` must match actual imports from emitted `dist` files.
- Bundled internal workspace packages belong in `devDependencies` unless emitted runtime imports prove otherwise.
- Any `knip` ignore for orchestrator dependencies must be justified by bundled transitive runtime usage.
