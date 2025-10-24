Here’s a **concrete, build-ready plan** for your pipeline — from small CLIs to a single command, with clear modules, tech stack, file layout, and acceptance checks Codex can implement straight away.

# Tech stack (unified, low-friction)

* **Runtime:** Node.js 22 (via nvm), **pnpm** workspaces, **TypeScript**.
* **Core libs:**

  * Markdown/front-matter: `remark` + `remark-frontmatter` + `gray-matter`
  * Validation: `zod` (runtime), JSON Schema export (for editor linting)
  * Notion: `@notionhq/client`
  * CLI: `commander`, `ora`, `chalk`
  * HTTP: `axios`
  * Env/secrets: `dotenv`
* **Tests:** `vitest` + fixtures.
* **Optional TUI later:** `ink` (React for CLI) — keep pure CLI first.

> Rationale: You already used Node + pnpm for the colorizer; keeping a single TS stack minimizes setup and RAM load in WSL.

---

# Monorepo layout (pnpm workspaces)

```
esl-pipeline/
  packages/
    md-validator/              # validates .md against our rules
    md-extractor/              # extracts sections (study text, answer keys)
    notion-importer/           # creates DB page, converts MD->Notion blocks
    notion-styler/             # your heading colorizer CLI (already built)
    tts-elevenlabs/            # generate mp3 from study text, map speakers->voices
    storage-uploader/          # push mp3 to S3/MinIO or Drive + return public URL
    orchestrator/              # 'new-assignment' end-to-end command
    shared/                    # shared types (Zod schemas), utils, logging
  configs/
    presets.json               # color presets for notion-styler
    students/anna.json         # per-student settings (DB ids, voice map, preset)
    voices.yml                 # default voice map (speaker -> voice_id)
  .env.example
  package.json                 # workspaces + scripts
  README.md
```

---

# Module-by-module

## 1) `md-validator` (CLI + lib)

**Goal:** Ensure the LLM output exactly fits your importer & styler.

**Validates:**

* **One** code block containing the document (no nested code fences).
* **YAML front matter** with required keys:

  ```yaml
  title: string (non-empty)        # "Homework Assignment: <topic>"
  student: string
  level: string
  topic: string
  input_type: enum("generate","authentic")
  speaker_labels?: string[]        # optional, if dialogue
  ```
* **H2 section order:** 1..9 exactly as in your template.
* **Markers present & unique:**

  * `:::study-text` … `:::`
  * `:::toggle-heading Answer Key` … `:::`
  * `:::toggle-heading Teacher’s Follow-up Plan` … `:::`
* **Study text format:**

  * If `speaker_labels` present → every dialogue line must be `[Name]: text`, and each `Name` ∈ `speaker_labels`.
  * Else → 3–5 paragraphs or 10–15 short lines (soft check).
* **No extra code blocks** inside the main doc.
* Optional sanity checks: 8–10 items under **Controlled Practice**, ≥2 items under **Comprehension Check**.

**CLI:**

```bash
md-validate ./out/anna-2025-10-21.md --strict
# exit 0 on pass; exit 1 with a ranked list of issues on fail
```

**Output (example fail):**

```
✖ Missing front-matter key: 'topic'
✖ Section order invalid: found '## 8. Answer Key & Sample Mission' before '## 7. Why...'
✖ study-text: Found speaker "Alex" not listed in speaker_labels: [Mara]
```

**Implementation sketch:**

* Parse with `gray-matter` → front-matter + body.
* Find the **single** code block (regex or fenced markdown node).
* Walk H2/H3 using `remark` AST.
* Markers: scan the raw code block (string), record ranges.
* Validate with `zod`; expose a function that returns `{ ok, errors[] }`.

**Deliverables:** TS library + bin `md-validate`.

---

## 2) `md-extractor`

**Goal:** Provide **structured pieces** to later tools.

**Exports:**

* `extractFrontmatter(md) → {title, student, level, topic, input_type, speaker_labels?}`
* `extractStudyText(md) → { type: "dialogue" | "monologue", lines: string[] }`
* `extractAnswerKey(md) → { blocks: string }`
* `extractTeacherNotes(md) → { blocks: string }`
* `extractSections(md) → structured AST, for importer`

**Note:** Works on the **same single code block** string.

---

## 3) `notion-importer` (CLI + lib)

**Goal:** From MD → create Notion DB item and page content in the right structure.

**Inputs:**

* `--md path`
* `--db "Homework Assignments"` or `--db-id <id>`
* `--student "Anna"` or map via `configs/students/*.json`
* `--parent-id` (optional) if not using a DB
* `--dry-run`

**Behavior:**

1. Use `md-validator` programmatically. Abort on fail.
2. Create a new DB row with:

   * **Title** = `frontmatter.title`
   * **Relations/props**: `Student`, `Topic`, `Date` (today), etc.
3. Convert MD → Notion blocks:

   * H2/H3 → `heading_2/3` (`is_toggleable` only for `:::toggle-heading …` regions).
   * `:::study-text` → **toggle** (non-heading) with nested paragraphs (or dialogue lines).
   * Lists, paragraphs handled via basic mapping (remark AST → Notion blocks).
4. Save resulting **page_id** for downstream.

**CLI:**

```bash
assign-md-to-notion \
  --md ./out/anna-2025-10-21.md \
  --db "Homework Assignments" \
  --student "Anna" \
  --dry-run=false
```

**Output:** prints the **new Notion page URL/ID**.

---

## 4) `notion-styler` (existing; just integrate)

**Goal:** Color headings exactly as you want; already implemented.

**We’ll add presets:**
`configs/presets.json`

```json
{
  "b1-default": {
    "levels": ["h2", "h3"],
    "map": { "h2": "yellow_background", "h3": "purple_background" },
    "toggleMap": { "h2": "yellow_background" }
  }
}
```

**CLI integration example (after import):**

```bash
notion-color-headings "<page-id-or-url>" \
  --levels=h2,h3 \
  --map=h2=yellow_background,h3=purple_background \
  --toggle-map=h2=yellow_background
```

---

## 5) `tts-elevenlabs`

**Goal:** Generate MP3 for the study text and return a path.

**Inputs:**

* `--md path` (or `--text path`)
* `--voice-map configs/voices.yml` (speaker → voice_id)
* `--speed`, `--stability` (optional)
* `--out ./out/anna/2025-10-21_study-text.mp3`
* `--preview` (generate but don’t upload/insert)
* **Secrets**: `ELEVENLABS_API_KEY` in `.env`

**Behavior:**

* Use `md-extractor.extractStudyText`.
* Dialogue: group by speaker → generate chunks or one joined stream depending on API cost.
* Monologue: single voice.
* Write MP3; emit duration and file size.

**CLI:**

```bash
make-tts-eleven \
  --md ./out/anna-2025-10-21.md \
  --voice-map ./configs/voices.yml \
  --out ./out/anna/2025-10-21_study-text.mp3 \
  --preview
```

---

## 6) `storage-uploader`

**Goal:** Make the MP3 reachable by Notion.

**Backends (choose one, pluggable):**

* **MinIO / S3**: put object + **presigned, long-lived** or public bucket.
* **Google Drive**: upload and set sharing “Anyone with link; Viewer” (works well in practice).

**CLI:**

```bash
upload-audio \
  --file ./out/anna/2025-10-21_study-text.mp3 \
  --backend s3 \
  --key lessons/anna/2025-10-21_study-text.mp3
# prints a public URL
```

**Secrets:** `AWS_*` or Drive creds in `.env`.

---

## 7) Add audio block to Notion (small util, or inside importer)

**Goal:** Insert an **audio block (external)** right **under the study-text toggle**.

**CLI:**

```bash
notion-add-audio \
  --page-id <id> \
  --target "study-text" \
  --url "https://cdn.yours3/.../study-text.mp3"
```

**Behavior:**

* Find the toggle created from `:::study-text`, append an `audio` block with `external.url`.
* If an existing audio block is found, update/replace.

---

## 8) `orchestrator` — one command to rule them all

**Goal:** Tie everything together with flags to enable/skip steps.

**CLI:**

```bash
new-assignment \
  --student "Anna" \
  --audio-dir ./recordings/anna/2025-10-21 \
  --notes ./notes/anna-2025-10-21.yml \
  --md ./out/anna-2025-10-21.md \
  --preset b1-default \
  --with-tts \
  --upload s3 \
  --open-ai-studio   # optional: open browser and prep clipboard text
```

**Default flow:**

1. (Optional) **Run Deepgram** batch if `--audio-dir` provided (or just call your existing script).
2. **Pause for AI Studio** (if `--open-ai-studio`): open tab & copy prompt skeleton to clipboard (no scraping).
3. **Validate** `--md` via `md-validator` (fail-fast).
4. **Import** → Notion (get `page_id`).
5. **Style** headings via preset (call `notion-styler`).
6. **TTS** from study text (if `--with-tts`).
7. **Upload** MP3 (`storage-uploader`) → URL.
8. **Insert** audio block (`notion-add-audio`).
9. Print summary (page URL, audio URL).
10. Write a **manifest.json** to `./out/.../manifest.json` with page_id, audio url, hash of md → enables idempotent reruns.

**Idempotency rules:**

* If `manifest.json` exists and `md` hash unchanged → skip re-import, allow only color restyle or audio replace with `--force`.

---

# Config & secrets

`.env.example`

```
NOTION_TOKEN=secret_xxx
NOTION_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ELEVENLABS_API_KEY=xxxxx
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=xxxxx
AWS_SECRET_ACCESS_KEY=xxxxx
S3_BUCKET=notion-tts
```

`configs/students/anna.json`

```json
{
  "student": "Anna",
  "dbId": "xxxxxxxx",
  "pageParentId": null,
  "colorPreset": "b1-default",
  "voices": { "Alex": "voice_id_1", "Mara": "voice_id_2", "default": "voice_id_default" }
}
```

---

# Acceptance tests (executable fixtures)

* **md-validator**

  * `fixtures/ok.md` → exit 0.
  * `fixtures/missing-frontmatter.md` → exit 1 with “Missing key: title”.
  * `fixtures/wrong-order.md` → exit 1.
  * `fixtures/dialogue-bad-speaker.md` → exit 1.
* **notion-importer** (use a stub client in tests)

  * Creates the right nested structure for `:::toggle-heading` and `:::study-text`.
  * Returns `page_id`.
* **notion-styler**

  * Given a synthetic page (mocked), applies `toggleMap` as **annotations only** and no child bleed.
* **tts-elevenlabs** (mock network)

  * Dialogue splits by `[Name]:`.
  * Writes an mp3 (fake bytes) to disk.
* **storage-uploader** (use LocalStack or dry-run)

  * Produces a URL.
* **orchestrator**

  * With all mocks, runs end-to-end and writes `manifest.json`.

---

# CLI examples (day-to-day)

**Validate only**

```bash
md-validate ./out/anna-2025-10-21.md --strict
```

**Import + style (no TTS yet)**

```bash
assign-md-to-notion --md ./out/anna-2025-10-21.md --db "Homework Assignments" --student "Anna"
notion-color-headings "<printed-page-id>" --levels=h2,h3 --map=h2=yellow_background,h3=purple_background --toggle-map=h2=yellow_background
```

**Full pipeline**

```bash
new-assignment \
  --student "Anna" \
  --md ./out/anna-2025-10-21.md \
  --preset b1-default \
  --with-tts \
  --upload s3
```

---

# Windows/WSL notes

* Put binaries (`new-assignment`, etc.) into `~/bin` and add to PATH in WSL.
* Audio preview: open the resulting URL in Windows browser via `wslview <url>`.
* Large audio directories: ensure they sit on the Linux filesystem (`~/`) for speed, not on the Windows mount (`/mnt/c/...`).

---

# Roadmap (grow as needed, no rewrite)

1. **Ship now:** `md-validator`, `notion-importer`, preset wiring into your existing `notion-styler`.
2. Add `tts-elevenlabs` + `storage-uploader` + `notion-add-audio`.
3. Wrap all in `orchestrator`.
4. Optional TUI polish with `ink` (progress bars, checkboxes for “re-run TTS?”, “open page in browser?”).
5. Optional: switch step 2 to **API** (OpenRouter/Gemini) with the same output template; keep AI Studio as a fallback flag.