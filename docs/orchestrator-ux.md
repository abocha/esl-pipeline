# Orchestrator UX Plan

Goal: make `esl-orchestrator` the single entry point teachers use to generate and maintain assignments.

## Guiding Principles

- **Progress visibility**: show validation/import/tts/upload progress with clear outcomes.
- **Fast retries**: allow re-running only the steps that failed (e.g., regenerate audio, re-upload, recolor headings).
- **Safe defaults**: auto-populate S3 prefixes, presets, and voice maps from student profiles.
- **Interactive first**: provide prompts when flags are omitted; keep full flag-based scripting for automation.

## Recently Shipped

- `--interactive` wizard now opens with a menu (Start/Settings/Preset) and supports `Saved defaults…` to load/store manual presets under `configs/wizard.defaults.json`, plus an Enquirer-backed fuzzy picker for Markdown selection (shares filters with `esl-orchestrator select`).
- Step-control flags `--skip-import`, `--skip-tts`, `--skip-upload`, and `--redo-tts` support incremental reruns.
- `--json` flag produces structured logs with event history; default console output shows summaries.
- TTS stage summaries list the speaker → voice mapping (with gender/source tags) so audio issues are easy to spot, and ffmpeg output stays quiet unless synthesis fails.

## Proposed Enhancements (remaining)

1. **Interactive Wizard (`--interactive`)**
   - ✅ Detects missing flags, surfaces student profiles, presets, voice paths, and supports forced re-generation.
   - ⏭️ Enhancements: allow inline editing of frontmatter and review summary before execute.

2. **Step Control Flags**
   - ✅ `--skip-import`, `--skip-tts`, `--skip-upload`, `--redo-tts` implemented; reuses manifest state safely.
   - ⏭️ Future ideas: expose `--skip-add-audio` or partial colorize toggles.

3. **Manifest Management**
   - `esl-orchestrator status --md lesson.md` to read the manifest and report current page/audio state.
   - `esl-orchestrator rerun --md lesson.md --step upload` to execute a subset using cached assets.

4. **Structured Logging**
   - ✅ `--json` flag now emits `{ events, result }`; console output gains emoji markers and summary block.
   - ⏭️ Follow-up: emit per-step timings and persist logs alongside manifests.

5. **Config Profiles**
   - Load per-student configs from `configs/students/*.json` (contains Notion IDs, voice overrides, presets).
   - CLI flag `--student anna` auto-fills `--voices`, `--preset`, `--db-id`.
   - Built-in `Default` profile keeps sensible color defaults even when you skip picking a student; `accentPreference` (when provided) steers the voice picker toward British/American variants.
   - `pageParentId` is still optional—only set it if you deliberately parent pages under a normal Notion page; most flows stick with the database ID alone.

## Implementation Order

1. Manifest utilities (`status`, `rerun`) – leverage existing manifest JSON.
2. Interactive prompt layer using `prompts` or `enquirer`.
3. Logging refactor (structured builder) and JSON output flag.
4. Config profile loader + voice/preset defaults.
5. Step control flags and retry flow.

Feedback welcome before implementation.
