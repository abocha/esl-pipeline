# ESL Pipeline — Phased Plan to v1.0

Below is a practical, dependency-aware path from today’s scaffold to a reliable, idempotent, one-command pipeline.

## Phase 1 — Stabilize the Import Path (Notion, Validation, Blocks)

**Goal:** Import any validated MD into the correct Notion data source with perfect fidelity.

* Tasks

  * Finalize `resolveDataSourceId` (db vs data source name/ID; clear errors on ambiguity).
  * Swap validator **CLI spawn → programmatic API**; make importer fail fast with structured errors.
  * Lock MD→Notion mapping (H2/H3, `:::toggle-heading`, `:::study-text` toggle as **regular text toggle**).
  * Add exponential backoff + request_id logging; batch block creates where possible.
* Deliverables

  * Importer returns `{page_id, url}` deterministically; dry-run prints first N blocks + properties.
  * Unit tests for resolution/mapping; integration test with mocked Notion.
* DoD

  * Any repo fixture that passes `md-validator --strict` imports cleanly.

## Phase 2 — Colorizer Hook (Visible Win)

**Goal:** Apply a preset automatically after import.

* Tasks

  * Define `configs/presets.json` schema; validate with zod.
  * Implement heading/toggle color ops; skip gracefully on unknown colors.
  * Add `--preset <name>` to importer (or orchestrator first), with summary counts.
* Deliverables

  * `applyHeadingPreset(pageId, preset)` with counters; tests w/ mocked Notion.
* DoD

  * Import + colorize in one command; dry-run prints planned color ops.

## Phase 3 — Real TTS (ElevenLabs) + Chunking

**Goal:** Produce stable MP3 for `:::study-text` (dialogue or monologue).

* Tasks

  * Implement `extractStudyText` use; dialogue speaker parsing with fallback.
  * Load `voices.json`; resolve per-speaker voice; default narrator.
  * Chunking strategy (per line/sentence with max char/SSML); stitch; normalize bitrate.
  * Deterministic cache via SHA256 of normalized study-text + voice map; `--force` to bypass.
* Deliverables

  * `buildStudyTextMp3` returns `{path, duration, hash}`; golden tests (duration ± tolerance).
* DoD

  * Same input ⇒ same audio hash; handles long dialogs without API throttling issues.

## Phase 4 — Storage Uploader (S3) + URLs

**Goal:** Make audio reachable by Notion.

* Tasks

  * Implement S3 PutObject + optional presign; honor `.env` (`S3_BUCKET`, `S3_PREFIX`, region, creds).
  * Path convention: `audio/assignments/<student>/<YYYY-MM-DD>/<slug>.mp3`.
  * Mode: **public prefix** (recommended) or **private + presigned** with configurable TTL.
  * Optional: local dev via MinIO/localstack.
* Deliverables

  * `uploadFile(..., {backend:'s3', public?:boolean}) → {url, key, etag, isPresigned?, expiresAt?}`.
  * Tests with AWS SDK v3 mocked; e2e against localstack in CI (optional).
* DoD

  * Returns a working URL; duplicate runs are idempotent (same key unless `--force`).

## Phase 5 — Notion Add-Audio (Insert/Replace under study-text)

**Goal:** Place the audio block exactly where users expect.

* Tasks

  * Find the **regular text toggle** titled `study-text` (case-insensitive), not heading toggle.
  * Default policy: **replace** existing audio; `--append` to keep both.
  * Idempotency: no-op if identical URL already present.
* Deliverables

  * `addAudioUnderStudyText(pageId, url, {replace?:boolean}) → {replaced, appended}` with tests.
* DoD

  * Re-runs don’t duplicate; clear error if target toggle not found.

## Phase 6 — Orchestrator v0.9 (End-to-End + Manifest)

**Goal:** One command to run the whole flow, safely re-runnable.

* Tasks

  * Steps: Validate → Import → Colorize → (if `--with-tts`) TTS → Upload → Add-audio.
  * `manifest.json` next to MD: `{ mdHash, pageId, pageUrl, audio:{url?,hash?}, preset, timestamp }`.
  * Idempotency: skip steps that haven’t changed (hash compare); `--force` to redo; `--force=tts` granular.
  * Structured logs (JSON-lines) with step, duration, request_id when available.
* Deliverables

  * `new-assignment` CLI prints concise JSON summary + links.
  * E2E dry-run test (no network) + smoke E2E (mocked network).
* DoD

  * Clean re-runs; minimal console noise unless `--verbose`.

## Phase 7 — Hardening, DX, and CI/CD

**Goal:** Make it pleasant and safe to use/maintain.

* Tasks

  * **Config guardrails:** startup env validation with friendly messages.
  * **Project refs:** tsc build order; prebuild hooks; `workspace:*` consistency.
  * **CLI UX:** `--help` quality, examples, consistent flag names; chalk + optional ora spinners.
  * **CI:** GitHub Actions: setup PNPM cache, `pnpm -r i`, `pnpm -r build`, `pnpm -r test`; optional matrix for Node LTS.
  * **Rate limits:** central retry/backoff utility; bounded concurrency; 429 tests.
  * **Security:** never log secrets; optional AWS IAM least-privilege policy doc.
* Deliverables

  * Passing CI, pinned toolchain via `packageManager` + `pnpm.overrides`.
* DoD

  * Fresh clone → `pnpm i && pnpm -r build && pnpm cli:orchestrator -- --dry-run …` works.

## Phase 8 — Docs, Samples, and v1.0 Cut

**Goal:** Ship confidently with crisp docs.

* Tasks

  * **README(s):** quickstart, env setup, Notion sharing checklist (integration + data sources), S3 strategy (public vs presigned).
  * **Samples:** 2–3 complete MDs (dialogue/monologue), example `presets.json`, `voices.json`.
  * **Troubleshooting:** common Notion/S3/TTS errors with fixes.
  * **Changelog & versioning:** tag v1.0.0; optionally Changesets.
* DoD

  * New user can succeed in <10 min following docs.

---

## Cross-Cutting Checklists

**Readiness (before Orchestrator e2e)**

* `NOTION_TOKEN` set; integration shared with the **database container** that holds the target **data source**.
* Homework Assignments **data source** has properties: `Name` (title), `Student` (relation), `Topic` (multi-select), `Date` (created time), `Audio URL` (url).
* `STUDENTS_DB_ID` (data source) shared; at least one student page exists.
* S3: bucket + (public prefix **or** private + presign policy) working; `.env` complete.
* `configs/presets.json` and `voices.json` present (or defaults documented).

**Quality Gates per PR**

* Unit tests + lint/tsc pass.
* If touching Notion or S3 code: include mocked test and a dry-run print.
* Update docs/examples if flags or schema changed.

---

## Suggested Milestones

* **M1:** Phases 1–2 (Import stable + colorizer).
* **M2:** Phases 3–5 (TTS + upload + add-audio).
* **M3:** Phase 6 (orchestrator + manifest).
* **M4:** Phase 7–8 (hardening, CI, docs, v1.0).
