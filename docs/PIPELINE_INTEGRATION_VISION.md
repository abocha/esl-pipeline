# Pipeline Integration Operating Manual

This is the single operating manual for integrating `to-text-deepgram` (ttdg)
into `esl-pipeline` and running the full lesson-to-homework workflow. It is
written for a solo owner who needs long-term memory and for an assistant who
needs explicit, stable context.

Note: This manual documents the Phase 1, CLI-driven workflow. The pipeline-native
transcription system that will supersede it is specified in
docs/design/TRANSCRIPTION_PIPELINE_SPEC.md and is not the current operational path.
Implementation steps for that Phase 2+ work live in
docs/design/TRANSCRIPTION_PIPELINE_IMPLEMENTATION_MANUAL.md.

## 1) System map (end-to-end)

1. Record lesson on Windows (Opus files per student).
2. Transcribe with ttdg (audio -> transcript + md stub).
3. Assemble LLM prompt package automatically (template + profile + transcript).
4. Generate homework draft via LLM prompt (manual web UI for now).
5. Review and approve in the web UI.
6. Generate TTS audio.
7. Publish to Notion (or AppFlowy later).
8. Persist manifest and metadata for reruns and reporting.

### 1.1 Final pipeline description (canonical)

1. Record lesson on Windows (per-student Opus files).
2. Run `to-text-deepgram` CLI (Python 3.12+, Deepgram key, ffprobe) to
   transcribe; it outputs `{stem}.txt` plus a `{parent}_{stem}.md` stub inside
   `student/YYYY-MM-DD_HH-MM-SS/`.
3. Assemble the LLM prompt package (template + profile + transcript). This is
   automatic and does not call an LLM.
4. Generate homework draft in the external LLM web UI using the assembled
   prompt, then paste/import the draft into the web UI.
5. Review and approve the draft in the web UI.
6. batch-backend runs the orchestrator on the final approved homework `.md`:
   - validate Markdown
   - extract study text
   - create/update Notion page
   - apply heading presets
   - generate TTS audio
   - upload audio (S3 or configured store)
   - attach audio in Notion
   - persist manifest (disk or S3)
7. The manifest + job metadata become the durable record for reruns and
   reporting.

## 2) Current assets and where they live

### 2.1 to-text-deepgram
- CLI for transcription, caching, archiving, and reports.
- Per recording folder output (relative to the lessons root):
  - Moved audio (when move enabled): `student/YYYY-MM-DD_HH-MM-SS/`.
  - `{stem}.txt` transcript.
  - `{parent}_{stem}.md` stub for downstream prompts.

Markdown stub contents:
````markdown
```

```
````

Key modules:
- `src/to_text_deepgram/pipeline.py` (transcription workflow, stub creation).
- `src/to_text_deepgram/archive.py` (monthly archive, resume, verify).
- `src/to_text_deepgram/cli.py` (commands and flags).

### 2.2 esl-pipeline (Node 24 + pnpm monorepo)
The web stack is the primary interface. The CLI is legacy.

Core runtime packages and entry points:
- `packages/batch-backend`
  - `src/application/process-queue-job.ts` (BullMQ worker, job state, calls orchestrator).
  - `src/infrastructure/orchestrator-service.ts` (createPipeline wiring, manifest store).
  - `src/infrastructure/pipeline-worker-entry.ts` (child process pipeline execution).
- `packages/batch-frontend` (primary UI).
- `packages/orchestrator` (pipeline core and CLI in `bin/cli.ts`).
- Supporting packages: md validation/extraction, Notion import, TTS, storage uploader.

System-level docs (authoritative):
- `docs/reference/agents-ssot.md` (contracts and invariants).
- `docs/reference/pipeline-manifest.md` (manifest schema).
- `docs/backend-frontend/backend-frontend-alignment.md` (frontend/backend roadmap).

### 2.3 Prompts and profile assets
- `docs/misc/PROFILE_2025-11-16.md` (LLM-written profile example).
- `docs/misc/hw_prompt_v4_clean.md` (homework prompt).
- `docs/misc/NEW PROFILE.txt` (profile creation prompt).

### 2.4 Config and student metadata (esl-pipeline)
- `configs/presets.json`, `configs/voices.yml`.
- `configs/students/*.json` (student metadata used by pipeline presets).

### 2.5 Prompt assembly inputs (automatic, manual LLM)
Inputs are concatenated into a single prompt payload, then used manually in the
external LLM web UI:
- Prompt template: `docs/misc/hw_prompt_v4_clean.md`.
- Student profile: DB record or file (example: `docs/misc/PROFILE_2025-11-16.md`).
- Lesson transcript: ttdg output text file (default `{stem}.txt`, configurable
  via `output_template`).

Stitching details (exact order and formatting):
1. Start with `docs/misc/hw_prompt_v4_clean.md` as the base template.
2. Replace the line `INSERT PROFILE HERE` (line 15) with the full student
   profile text (entire contents of the profile record/file).
3. Append a `[NOTES]` header and the manual notes text (UI text field).
4. Append a `[TRANSCRIPT]` header and the full ttdg transcript text.
   - The transcript may include the optional SANITY header unless disabled via
     `--no-header` / `TTDG_WRITE_HEADER=false`.

Example (structure only; placeholders shown):
```text
...content from hw_prompt_v4_clean.md above...

<PROFILE CONTENT REPLACES INSERT PROFILE HERE>

[NOTES]
<MANUAL NOTES FROM UI>

[TRANSCRIPT]
<FULL TRANSCRIPT FROM ttdg>
```

## 3) Runtime environment and constraints

- Windows is the recording and ttdg runtime.
- esl-pipeline runs in Docker on the same laptop.
- Docker cannot access Windows paths unless they are mounted. Options:
  - Mount a shared folder so Docker can read transcripts and audio.
  - Push transcripts/audio to S3 and treat local disk as a cache.

Tooling requirements:
- ttdg: Python 3.12+, Deepgram API key, ffprobe on PATH.
- esl-pipeline: Node 24.11.1+, pnpm, ffmpeg, Notion and ElevenLabs keys.

## 4) Data artifacts and naming

- Audio input: `D:\..._lessons\<student>\YYYY-MM-DD_HH-MM-SS.opus`.
- Transcription folder (ttdg with move enabled):
  - `..._lessons\<student>\YYYY-MM-DD_HH-MM-SS\YYYY-MM-DD_HH-MM-SS.opus`
  - `..._lessons\<student>\YYYY-MM-DD_HH-MM-SS\YYYY-MM-DD_HH-MM-SS.txt`
    (default; configurable via `output_template`)
  - `..._lessons\<student>\YYYY-MM-DD_HH-MM-SS\<student>_YYYY-MM-DD_HH-MM-SS.md`
- Archive outputs:
  - `..._archive\YYYY-MM.tar.zst`
  - `..._archive\YYYY-MM.manifest.jsonl`
  - `..._archive\_staging\...` (temporary, recoverable)

The pipeline manifest (orchestrator) is the durable record of each run and is
stored either on disk or in S3. See `docs/pipeline-manifest.md`.

## 5) Operating runbook

### Daily transcription (Windows)
```powershell
uv run python -m to_text_deepgram run --workdir D:\Download\Videos\_lessons
```
- Verify `{stem}.txt` and `{parent}_{stem}.md` exist in each folder.
- Use `ttdg report --topic transcript --workdir D:\Download\Videos\_lessons` for cache
  and history stats.
- For automation, prefer JSON output:
  `ttdg report --topic transcript --json --workdir D:\Download\Videos\_lessons`.
- Dry-run listing:
  `ttdg run --dry-run --workdir D:\Download\Videos\_lessons`.

### Monthly archive (Windows)
```powershell
uv run python -m to_text_deepgram archive --workdir D:\Download\Videos\_lessons
```
- Default behavior re-encodes Opus and packs into monthly tar.zst.
- If `_archive/_staging` exists, choose continue or cleanup.

### Pipeline execution (web UI)
- Use batch-frontend to submit or approve jobs.
- batch-backend runs the orchestrator and writes manifests.
- Uploaded Markdown usually resolves via `uploads/` or absolute path.

## 6) Integration strategy (wire ttdg into esl-pipeline)

Recommended near-term approach:
1. Keep ttdg as a separate Python CLI.
2. Add a "transcribe" step in batch-backend before orchestrator execution.
3. Run ttdg via `child_process` and capture the transcript output for prompt
   assembly (prefer `--json-summary` for machine-readable output paths).
4. Pass the final approved homework `.md` into `runAssignmentJob` /
   `pipeline.newAssignment`.

Files to update when integrating:
- `packages/batch-backend/src/application/process-queue-job.ts`
- `packages/batch-backend/src/infrastructure/orchestrator-service.ts`
- `packages/batch-backend/src/infrastructure/pipeline-worker-entry.ts`

Mid-term:
- Use shared folder mounts so Docker can see transcription outputs.
- Store transcript path and student metadata in job records.

Long-term:
- Move audio and transcripts to S3.
- Treat local disk as cache only.
- Keep manifest and job metadata in one place for reporting.

## 7) Configuration and secrets

ttdg:
- `DEEPGRAM_API_KEY` (env, `.env`, or `dg.key`).
- Optional local config in `.ttdg.toml`.

esl-pipeline:
- `.env` for CLI / orchestrator.
- `.env.batch-backend` for Docker services.
- Key env vars: `NOTION_TOKEN`, `ELEVENLABS_API_KEY`, `S3_BUCKET`,
  `ESL_PIPELINE_MANIFEST_STORE`, etc. See `docs/env.md`.

## 8) Observability and reporting

- ttdg:
  - Console progress and summary output.
  - `ttdg report --topic transcript --workdir D:\Download\Videos\_lessons`
    (history and cache stats).
  - `ttdg report --topic archive --workdir D:\Download\Videos\_lessons`
    (monthly savings and per-student totals).
- esl-pipeline:
  - Manifest files are the authoritative run record.
  - Backend logs include job lifecycle.
  - SSE stream provides live job updates to the UI.

## 9) Known risks and roadblocks

- Windows and Docker path mapping is the main integration risk.
- Prompt drift: prompts and profile templates must be versioned.
- The pipeline expects valid Markdown with correct frontmatter and study-text.
- Notion schema changes can break imports and must be tracked.
- LLM generation needs deterministic input selection rules.

## 10) Roadmap (phases with done-when)

Phase 1: Minimal integration
- ttdg produces `.md` and backend runs orchestrator on it.
- Add a backend transcribe step that runs ttdg and captures transcript output.
- Assemble prompt package (template + profile + notes + transcript) for manual LLM use.
- Use UI notes field and prompt package view/download.
- Run orchestrator only on final approved homework `.md`.
- Persist transcript path and prompt payload in job records.
- Done when: lesson -> transcript -> prompt package -> manual LLM draft -> approval -> Notion page works from the UI.

Phase 1: Acceptance criteria
- A UI-triggered job runs ttdg and records the transcript output path.
- Prompt package is generated with correct stitching (template, profile, notes, transcript).
- User can paste manual LLM output into the UI and approve it.
- Orchestrator runs on the approved `.md` and writes a manifest.

Phase 2+ (pipeline-native transcription; successor to Phase 1)
- Replace ttdg CLI with a native ingestion/transcription service.
- Support folder-scan ingestion first; upload ingestion later (S3-backed).
- Persist recordings/transcripts/prompts as artifacts with storage URIs.
- Materialize drafts to filesystem before orchestrator approval.
- See docs/design/TRANSCRIPTION_PIPELINE_SPEC.md for the full Phase 2+ spec.

Phase 2: Profile store + LLM draft
- Store student profile and recent lesson context.
- Assemble the LLM prompt automatically (template + profile + transcript).
- Draft homework still uses the external LLM web UI (no API).
- Done when: prompt package is generated and the draft appears in UI for approval.

Phase 3: Unified UX
- Approve in UI, then TTS + publish in one flow.
- Done when: manual CLI steps are no longer needed.

Phase 4: Storage modernization
- S3 for audio, transcripts, and manifests; local disk is cache.
- Done when: pipeline runs without local disk dependency.

## 11) Open decisions (track here)

- Where to persist student profile summaries (DB vs files).
- Whether to keep ttdg in Python or port to Node.
- When to switch to AppFlowy and what it replaces.
- How to version LLM prompts and inputs (files vs DB).
- Which API-based LLM provider to use (cost/quality tradeoffs) and when to
  switch from manual usage.

## 12) If you forget where to look

- `esl-pipeline/docs/reference/agents-ssot.md` is the authoritative contract.
- `esl-pipeline/docs/reference/pipeline-manifest.md` defines manifest structure.
- `esl-pipeline/docs/backend-frontend/backend-frontend-alignment.md` tracks UI/backend gaps.
- `to-text-deepgram/README.md` and `to-text-deepgram/AGENTS.md` cover CLI usage and repo rules.

## 13) Implementation details

### Phase 1 Integration Plan (Minimal, manual LLM retained)

Goal: From UI, run ttdg → assemble prompt → manually generate draft → approve → orchestrator runs on approved .md → Notion + manifest.

#### Scope

- Batch backend runs ttdg via child_process and captures transcript path.
- Prompt assembly outputs a single payload (template + profile + notes + transcript).
- Orchestrator runs only on the final approved homework .md.
- No programmatic LLM calls.

#### Work items

1. Backend: ttdg execution
    - Add a “transcribe” step in packages/batch-backend/src/application/process-queue-job.ts.
2. Prompt assembly service
    - Implement prompt assembly utility (template + profile + notes + transcript).
    - Source template from docs/misc/hw_prompt_v4_clean.md.
    - Replace INSERT PROFILE HERE with student profile text.
    - Append [NOTES] and [TRANSCRIPT] blocks.
3. UI workflow adjustments
    - Add a “Prompt package” view/download in UI.
    - Add a notes input field tied to prompt assembly.
    - Manual LLM step remains external; user pastes result back into UI.
4. Orchestrator handoff
    - Ensure the approved homework .md is what is passed to runAssignmentJob / pipeline.newAssignment.
    - Confirm validation/extraction/Notion/TTS/upload/manifest flow unchanged.
5. Path strategy
    - Define initial path access method: shared folder mount (preferred) or S3 bridge (if needed).
    - Document path mapping in the integration notes.

#### Acceptance criteria

- From UI, a job can trigger ttdg, and the system produces a prompt package with correct stitched content.
- User can manually generate draft in LLM UI, paste into UI, approve, and pipeline runs to Notion.
- Manifest is written and job is marked complete.
- Transcript path and prompt payload are stored for auditability.

- Docker ↔ Windows path access.
- Transcript output template mismatch (custom output_template).
- Manual step error (user pasting wrong content).
