# Supporting Libraries Overhaul: Staged Implementation Manual (v1)

This manual is the single, executable plan for the supporting‑libraries overhaul.
It is designed for an AI coder and must be followed exactly. All decisions are
locked unless this document is updated.

## Purpose

- Standardize on PMD (Pipeline Markdown) as the canonical authoring format.
- Parse once into a stable AST; adapt to Notion or future backends via adapters.
- Reduce drift across packages by centralizing parsing, Notion logic, and logging.
- Keep legacy fenced inputs as a deprecated fallback with warnings.

## Required Reading (Before Any Code)

- `docs/reference/agents-ssot.md` (single source of truth)
- `AGENTS.md` (repo constraints)
- `docs/reference/env.md` (env contract updates required)
- `docs/drafts/supporting-libraries-overhaul/markdown-input-format.md`
- `docs/drafts/supporting-libraries-overhaul/pipeline-content-model-draft.md`
- `docs/drafts/supporting-libraries-overhaul/notion-rendering-preferences.md`
- `docs/drafts/supporting-libraries-overhaul/supporting-libraries-overhaul-notes.md`

## Locked Naming Decisions

- Canonical format name: **PMD** (Pipeline Markdown).
- New package: `@esl-pipeline/pmd` (workspace: `packages/pmd`).
- Core AST types:
  - `PmdDocument`, `PmdBlock`, `PmdDirectiveBlock`, `PmdDirectiveLeaf`.
- Parser API:
  - `parsePmdDocument(markdown: string, opts?: ParseOptions): PmdDocument`
  - `parsePmdFromFile(path: string, opts?: ParseOptions): Promise<PmdDocument>`
- Notion adapter package: `@esl-pipeline/notion-adapter` (workspace: `packages/notion-adapter`).
- Env var for upload guardrail:
  - `S3_UPLOAD_MAX_MB` (default: `50`).
- Logger interface location:
  - `@esl-pipeline/contracts` exports `PipelineLogger` + `noopLogger`.
- Prompt version:
  - `hw_prompt_v4-1_clean.md` bumps to `v4.1` (frontmatter‑first, no fences).

## Architecture Overview

Authoring -> AST -> Adapters:

```
PMD Markdown (frontmatter-first)
          |
          v
@esl-pipeline/pmd parser
          |
          v
PmdDocument AST
   |           \
   v            v
Validator/      Adapters
Extractor        - Notion adapter (current)
                 - Future adapters (AppFlowy, self-hosted)
```

Frontend preview uses the same AST to render callouts/toggles/columns.

## Review Gates (Mandatory)

- Stage 0: docs-only; self-check for accuracy.
- Stage 1: formal review (parser + AST correctness).
- Stage 2: formal review (validator/extractor behavior).
- Stage 3 + 4: formal review (Notion adapter + property mapping).
- Stage 5 + 6: lightweight review (I/O + guardrails).
- Stage 7: formal review (logging contract).
- Stage 8: final review (end-to-end verification).

## Stage Summary (Order + Dependencies)

| Stage | Scope | Depends On | Review Gate |
| --- | --- | --- | --- |
| 0 | Docs + prompt version | None | Self-check |
| 1 | PMD parser package | 0 | Formal |
| 2 | Validator + extractor | 1 | Formal |
| 3 | Notion adapter + consolidation | 1 | Formal |
| 4 | Notion property mapping | 3 | Formal |
| 5 | TTS async + sanitization tests | 2 | Lightweight |
| 6 | S3 upload guardrail | 0 | Lightweight |
| 7 | Logging policy cleanup | 2 | Formal |
| 8 | End-to-end validation | 1–7 | Final |

## Stage 0 — Documentation Alignment

Goals: keep specs and prompts aligned before code changes.

Steps:
1) Update `docs/templates/hw_prompt_v4-1_clean.md` and bump prompt version to
   `v4.1` (frontmatter-first, no code fences). Keep `v4` available for rollback
   (duplicate the old prompt to a versioned file before changing it). Keep a
   note about UI copy behavior.
2) Update `docs/reference/env.md` with `S3_UPLOAD_MAX_MB` (default 50).
3) Update `.env.example` to include `S3_UPLOAD_MAX_MB` with a short comment.
4) Ensure drafts remain consistent:
   - `docs/drafts/supporting-libraries-overhaul/markdown-input-format.md`
   - `docs/drafts/supporting-libraries-overhaul/pipeline-content-model-draft.md`
   - `docs/drafts/supporting-libraries-overhaul/notion-rendering-preferences.md`
   - `docs/drafts/supporting-libraries-overhaul/supporting-libraries-overhaul-notes.md`

Definition of Done:
- Prompt updated to v4.1 and reflects frontmatter-first output.
- Env docs + `.env.example` include `S3_UPLOAD_MAX_MB`.
- Drafts remain consistent with decisions.

Rollback:
- N/A (docs-only).

## Stage 1 — PMD Parser Package

Goals: single parsing source of truth + nesting-aware directives.

Steps:
1) Create `packages/pmd`.
2) Add dependencies: `unified`, `remark-parse`, `remark-frontmatter`,
   `remark-directive`, `remark-gfm`, `gray-matter`.
3) Implement AST types and parser:
   - Validate frontmatter at byte 0.
   - Parse markdown + directives into PMD AST.
   - Detect legacy fenced input and emit warnings.
4) Add unit tests:
   - Directive nesting.
   - Legacy fenced input handling.
   - Required `study-text` detection.
5) Run `packages/pmd` tests.

Definition of Done:
- `packages/pmd` builds and tests pass.
- Parser handles nested directives correctly.
- Legacy fenced inputs emit warnings.

Rollback:
- Remove `packages/pmd`; keep existing parser logic unchanged.

## Stage 2 — Validator + Extractor Refactor

Goals: remove regex parsing and align on PMD AST.

Steps:
1) Replace md-validator parsing with PMD AST traversal.
2) Replace md-extractor `findBlock` with PMD directive lookup.
3) Keep legacy fence support, but warn immediately.
4) Document behavior changes in:
   - `packages/md-validator/CHANGELOG.md`
   - `packages/md-extractor/CHANGELOG.md`
5) Run md-validator/md-extractor tests.

Definition of Done:
- md-validator + md-extractor use PMD AST only.
- Legacy fenced inputs still accepted with warnings.
- No regressions in existing tests.

Rollback:
- Revert md-validator/md-extractor to previous parser paths.

## Stage 3 — Notion Adapter Consolidation

Goals: centralize Notion logic and align rendering with desired UI.

Steps:
1) Create `packages/notion-adapter` with modules:
   - `client.ts` (Notion client creation + version + timeouts)
   - `retry.ts` (shared retry/backoff policy)
   - `data-source.ts` (resolve DB/data source/student page)
   - `properties.ts` (property type mapping helpers)
   - `blocks/` (PMD -> Notion blocks)
   - `rendering.ts` (Answer Key/Teacher Plan + pronunciation rules)
   - `audio.ts` (attach/replace audio)
   - `importer.ts` (create page + append blocks)
   - `colorizer.ts` (heading presets, if retained)
2) Move Notion client creation + retry/backoff logic into the adapter.
3) Apply rendering preferences:
   - Answer Key and Teacher Follow-up Plan => plain toggles, no coloring.
   - Pronunciation callout => Target as title line; Focus/Action/Deliverable as
     bold-labeled paragraphs.
4) Update notion-importer to use the adapter.
5) Update notion-colorizer and notion-add-audio to use the adapter (or keep
   CLI wrappers that import adapter functions).
6) Update orchestrator imports to point to `@esl-pipeline/notion-adapter`.
7) Deprecate and retire `@esl-pipeline/notion-color-headings`.
8) Keep thin wrappers for one cycle, then remove old Notion packages after
   the adapter proves stable.
9) Run Notion-related unit tests and orchestrator tests that mock Notion libs.

Definition of Done:
- Adapter package is used by orchestrator.
- Old Notion packages are thin wrappers or deprecated.
- Notion rendering matches reference images.

Rollback:
- Point orchestrator back to old packages; keep adapter isolated.

## Stage 4 — Notion Property Mapping

Goals: support all valid Notion property types to prevent false failures.

Steps:
1) Fetch data source schema and map properties by type.
2) Implement mapping for: title, rich_text, number, select, multi_select,
   status, date, people, files, checkbox, url, email, phone_number, relation.
3) Explicitly skip Notion-generated properties (rollup/created*/last_edited*).
4) Add tests for property mapping correctness.
5) Run notion-importer/notion-adapter tests.

Definition of Done:
- Property mapping covers all supported types.
- Attempts to set Notion-generated properties are rejected.
- Tests cover mapping for at least one property of each type.

Rollback:
- Keep legacy property mapping and update docs to warn about limited support.

## Stage 5 — TTS + Sanitization

Goals: best-practice I/O and predictable speech preprocessing.

Steps:
1) Switch TTS input reads to async (no `readFileSync`).
2) Keep md-extractor output unchanged; ensure TTS sanitization handles punctuation.
3) Add tests for `cleanSpeechText` and speaker parsing edge cases.
4) Run TTS package tests.

Definition of Done:
- No sync file reads in TTS path.
- Sanitization behavior is tested and unchanged unless documented.

Rollback:
- Revert to sync reads; keep tests for future reattempt.

## Stage 6 — Storage Uploader Guardrails

Goals: prevent accidental large uploads without over-optimizing.

Steps:
1) Enforce `S3_UPLOAD_MAX_MB` (default 50).
2) Fail fast with a clear error when size exceeds cap.
3) Update `docs/reference/env.md` and `.env.example`.
4) Add tests or assertions that enforce the size cap behavior.

Definition of Done:
- Upload size cap enforced at 50 MB by default.
- `S3_UPLOAD_MAX_MB` overrides the cap.

Rollback:
- Disable guardrail via env or revert to previous behavior.

## Stage 7 — Logging Policy Cleanup

Goals: eliminate console noise from libraries.

Steps:
1) Add `PipelineLogger` + `noopLogger` to `@esl-pipeline/contracts`.
2) Update library entry points to accept optional `logger`.
3) Replace `console.*` calls with `logger` usage or returned warnings.
4) Keep CLI output via orchestrator (LTS-style convenience).
5) Run orchestrator tests that cover logging paths.

Definition of Done:
- Core libraries avoid direct `console.*`.
- Logs flow through `PipelineLogger` or returned warnings.

Rollback:
- Revert logger plumbing in affected libraries.

## Stage 8 — End-to-End Validation

Goals: ensure no functionality regressions.

Steps:
1) Run relevant unit tests and integration tests.
2) Validate fixture conversions for legacy + canonical inputs.
3) Verify Notion rendering matches reference images.
4) Ensure docs and drafts reflect any last-minute decisions.

Definition of Done:
- All stages verified with tests or documented manual checks.
- Release-ready docs updated.

Rollback:
- If regressions persist, pause rollout and re-open the stage that introduced them.

## Final Notes

- Any change that alters PMD, Notion adapter behavior, or property mapping must
  update relevant drafts and changelogs.
- The goal is predictable, testable behavior; prefer explicit errors over silent
  fallbacks.
