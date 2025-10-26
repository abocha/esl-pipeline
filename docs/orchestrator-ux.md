# Orchestrator UX Plan

Goal: make `esl-orchestrator` the single entry point teachers use to generate and maintain assignments.

## Guiding Principles

- **Progress visibility**: show validation/import/tts/upload progress with clear outcomes.
- **Fast retries**: allow re-running only the steps that failed (e.g., regenerate audio, re-upload, recolor headings).
- **Safe defaults**: auto-populate S3 prefixes, presets, and voice maps from student profiles.
- **Interactive first**: provide prompts when flags are omitted; keep full flag-based scripting for automation.

## Proposed Enhancements

1. **Interactive Wizard (`--interactive`)**
   - Detect missing flags (student, preset, upload target) and prompt with suggestions.
   - Display frontmatter summary and allow quick edits before import.

2. **Step Control Flags**
   - `--skip-import`, `--skip-tts`, `--skip-upload` for incremental runs.
   - `--redo-tts` to force regeneration even if audio hash matches.

3. **Manifest Management**
   - `esl-orchestrator status --md lesson.md` to read the manifest and report current page/audio state.
   - `esl-orchestrator rerun --md lesson.md --step upload` to execute a subset using cached assets.

4. **Structured Logging**
   - Add `--json` output option for scripting.
   - Default console output with grouped sections and success/failure icons.

5. **Config Profiles**
   - Load per-student configs from `configs/students/*.json` (contains Notion IDs, voice overrides, presets).
   - CLI flag `--student anna` auto-fills `--voices`, `--preset`, `--db-id`.

## Implementation Order

1. Manifest utilities (`status`, `rerun`) – leverage existing manifest JSON.
2. Interactive prompt layer using `prompts` or `enquirer`.
3. Logging refactor (structured builder) and JSON output flag.
4. Config profile loader + voice/preset defaults.
5. Step control flags and retry flow.

Feedback welcome before implementation.
