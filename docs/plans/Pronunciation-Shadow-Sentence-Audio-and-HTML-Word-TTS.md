# End-to-End Plan: Pronunciation Shadow-Sentence Audio + HTML Word TTS

## Summary

We will extend the assignment pipeline so that, in addition to study-text audio, we also generate and publish a second reference audio for C. Pronunciation Micro-Focus when the task is explicitly marked as
shadow-sentence mode. HTML output will also get browser speechSynthesis controls for the individual word drill items.
This will be implemented as additive, backward-compatible changes across prompt templates, markdown parsing/validation, TTS generation, upload/publish, Notion/Anytype attachment, HTML rendering, preview
API, manifest schema, tests, and docs.

## Success Criteria

1. For markdown containing C. Pronunciation Micro-Focus with explicit shadow-sentence marker, the pipeline generates both study-text audio and pronunciation sentence audio.
2. Pronunciation sentence audio is uploaded and published for notion, anytype, and html targets.
3. HTML render shows browser TTS play controls for the 3-5 word drill items in shadow-sentence mode.
4. Existing lessons and manifests continue to work unchanged.
5. No manifest schema bump is required; changes are additive.
6. Full test suite updates cover new behavior and backward compatibility.

## Explicit Content Contract (Decision Locked)

1. Shadow-sentence mode is activated only when the pronunciation callout contains: **Mode:** shadow_sentence.
2. Required in this mode: one line **Shadow sentence:** <sentence>.
3. Required in this mode: 3-5 numbered word drill items in format 1. <word> — /<transcription>/.
4. If mode is not shadow_sentence, no pronunciation sentence audio is generated and no word-level browser TTS controls are injected.
5. Word-level browser TTS is HTML-only; Notion/Anytype get only the sentence reference audio.

## Public APIs / Interfaces / Types to Add or Change

1. Add new PMD extractor export to parse pronunciation shadow focus metadata in packages/pmd/src/extract.ts and export via packages/pmd/src/index.ts.
2. Add new TTS API in packages/tts-elevenlabs/src/index.ts and packages/tts-elevenlabs/src/types.ts: buildPronunciationShadowSentenceMp3(...).
3. Extend manifest type in packages/orchestrator/src/manifest.ts with additive audioArtifacts map while preserving existing audio as study-text alias.
4. Extend Notion audio API in packages/notion-adapter/src/audio.ts: add target-aware attachment (study-text and pronunciation-shadow-sentence) and return inserted blockId.
5. Extend preview payload in packages/batch-backend/src/transport/extended-routes.ts with additive pronunciationAudioUrl while keeping audioUrl unchanged for study text.
6. Extend frontend preview API helper type in packages/batch-frontend/src/utils/api.ts with optional pronunciationAudioUrl.

## Implementation Plan

## 1) Prompt and Template Contract Updates

1. Update C. Pronunciation Micro-Focus instructions in docs/templates/hw_prompt_v4-3_voice-aligned.md and docs/templates/hw_prompt_v4-2_clean.md to require the exact mode marker and structure above.
2. Keep current snapshot IDs (hw_prompt_v4-2_clean, hw_prompt_v4-3_voice-aligned) unchanged; this is a content contract change, not a snapshot identity change.
3. Update any additional active template variant in docs/templates that is part of the generation allowlist to keep prompt outputs consistent.

## 2) PMD Extraction for Pronunciation Shadow Focus

1. Add a new extractor in packages/pmd/src/extract.ts that locates section ### C. ... Pronunciation Micro-Focus.
2. Parse lines for Mode, Shadow sentence, and word drill entries with transcription.
3. Return structured object:
 { mode, shadowSentence, words: [{ text, transcription }], sectionStartLine, issues[] } or null if mode is absent/not shadow.
4. Export this extractor from packages/pmd/src/index.ts.

## 3) Validation Rules for Shadow-Sentence Contract

1. In packages/md-validator/src/validator.ts, call the new PMD extractor and enforce:
 Mode: shadow_sentence implies one non-empty shadow sentence line, 3-5 word entries, and transcription format /.../.
2. Emit validation errors (not warnings) for malformed shadow mode so invalid content is blocked early when mode is declared.
3. Keep lessons without Mode: shadow_sentence unaffected.

## 4) TTS Package: Pronunciation Sentence MP3

1. In packages/tts-elevenlabs/src/types.ts, add types for shadow sentence build input/options/result.
2. In packages/tts-elevenlabs/src/index.ts, implement buildPronunciationShadowSentenceMp3(...) using existing ElevenLabs client + retry path.
3. Reuse existing output format/model defaults and retry/backoff behavior.
4. Deterministic hash inputs must include sentence text, selected voice, model, output format, and artifact kind (pronunciation_shadow_sentence).
5. Output filename pattern: <student-slug>-<hash>-shadow-sentence.mp3.
6. Return generated/cached character counters for telemetry parity with study-text TTS.

## 5) Orchestrator: Dual Artifact Lifecycle (TTS -> Upload -> Add-Audio)

1. In packages/orchestrator/src/index.ts, keep existing study-text flow intact and add optional pronunciation sentence flow after study-text TTS succeeds.
2. Resolve pronunciation voice deterministically from study-text result:
 prefer Narrator voice assignment, else first resolved study voice.
3. Add helper structure in-memory:
 audioArtifacts.studyText and optional audioArtifacts.pronunciationShadowSentence.
4. Upload stage uploads both artifacts when present; study-text key stays audio/final/<hash>.mp3; pronunciation key becomes audio/pronunciation-shadow/<hash>.mp3.
5. Keep audio field in returned result and manifest as study-text alias for compatibility.
6. Add-audio stage behavior:
 for notion, attach study-text audio near study-text and pronunciation audio near pronunciation section.
 for anytype and html, inject two generated audio links into markdown before publishing.
7. Update rerun paths to preserve and reuse both artifacts when available; old manifests continue to work via audio fallback.

## 6) Manifest Schema (Additive Only)

1. In packages/orchestrator/src/manifest.ts, add:
 audioArtifacts?: { studyText?: ..., pronunciationShadowSentence?: ... }.
2. Keep CURRENT_MANIFEST_SCHEMA_VERSION = 1.
3. Continue writing legacy-compatible audio from audioArtifacts.studyText.
4. Include optional notionBlockId under each artifact to support targeted replacement on reruns without deleting unrelated audio blocks.

## 7) Notion Adapter: Targeted Audio Attachment

1. Refactor packages/notion-adapter/src/audio.ts to target insertion by semantic anchor instead of page-wide audio deletion.
2. Target study-text: existing behavior anchor (before study-text toggle), but delete/replace only the previously tracked/generated block when possible.
3. Target pronunciation-shadow-sentence: anchor after H3 block matching C. ... Pronunciation Micro-Focus; insert one audio block there.
4. Return { replaced, appended, blockId } and persist blockId in manifest via orchestrator.
5. Preserve backward-compatible wrapper addOrReplaceAudioUnderStudyText(...).

## 8) Anytype + HTML Publish Insertion

1. Replace insertAudioBeforeStudyText with a generalized generated-audio injector in packages/orchestrator/src/index.ts.
2. Generated link labels are fixed:
 [Audio recording: Study Text](...) and [Audio recording: Pronunciation Shadow Sentence](...).
3. Study link insertion anchor: immediately before first :::study-text.
4. Pronunciation link insertion anchor: immediately after heading ### C. ... Pronunciation Micro-Focus.
5. Cleanup logic removes only these two generated labels to avoid touching user-authored audio directives/links.

## 9) HTML Renderer: Browser SpeechSynthesis for Word Drill

1. In packages/html-publisher/src/rendering.ts, add DOM post-processing script:
 detect pronunciation section in Mode: shadow_sentence, parse word list entries, append per-word play button.
2. Voice selection policy:
 first available en-US, else any en-*, else browser default.
3. Playback policy:
 button click only; speechSynthesis.cancel() then speak word utterance.
4. Compatibility policy:
 if SpeechSynthesis unsupported, render no controls and fail silently.
5. Add minimal CSS classes for controls and accessible labels.

## 10) Batch Preview API and Frontend Hook

1. In packages/batch-backend/src/transport/extended-routes.ts, extend /preview/html schema to accept optional pronunciationAudioUrl.
2. Replace broad audio-line stripping behavior with generated-audio-only injection logic so user-authored :::audio remains untouched.
3. In packages/batch-frontend/src/utils/api.ts, add optional pronunciationAudioUrl passthrough.
4. Keep current frontend usage unchanged unless caller wants to preview explicit pronunciation URL.

## 11) Telemetry and Logging

1. Add stage detail fields in orchestrator logs for pronunciation artifact presence and URLs/hashes.
2. Reuse existing artifact reuse metrics and add audioKind tag (study_text, pronunciation_shadow_sentence) where artifact reuse is emitted.
3. Emit explicit skip reasons when shadow mode is absent.

## 12) Documentation and SSOT Consistency

1. Update manifest docs in docs/reference/pipeline-manifest.md with audioArtifacts and compatibility notes.
2. Update SSOT in docs/reference/agents-ssot.md sections covering pipeline stages and manifest contract.
3. Update user-facing audio behavior notes in docs/reference/NOTION_FEATURES.md and package docs packages/tts-elevenlabs/README.md.
4. Update backend/frontend alignment status in docs/backend-frontend/backend-frontend-alignment.md for pronunciation audio + HTML word TTS coverage.

## Test Cases and Scenarios

## A) PMD + Validator

1. Valid shadow mode parses successfully with exactly one shadow sentence and 3-5 /.../ words.
2. Missing shadow sentence in shadow mode fails validation.
3. Word count 2 or 6 fails validation.
4. Missing transcription delimiters fails validation.
5. Mode absent does not trigger shadow rules.

## B) TTS ElevenLabs

3. Retryable provider errors follow retry policy and then succeed/fail with categorized errors.
## C) Orchestrator

1. newAssignment with valid shadow mode produces two artifacts in manifest and uploads both.
2. newAssignment without shadow mode produces only study-text artifact.
3. rerunAssignment on legacy manifest (only audio) still works and does not crash.
4. rerunAssignment with new manifest preserves both artifacts and block IDs.

## D) Notion Adapter

1. Study-text replacement does not delete unrelated top-level audio blocks.
2. Pronunciation target inserts at pronunciation anchor.
3. Replacement by stored blockId works and is idempotent.

## E) Anytype/HTML Publish

1. Generated study-text and pronunciation links are inserted at correct anchors.
2. Existing user-authored :::audio blocks remain untouched.
3. Re-publish does not duplicate generated links.

## F) HTML Renderer

1. Shadow mode pages render per-word browser TTS buttons.
2. Non-shadow pronunciation pages render no word TTS buttons.
3. Buttons are accessible (aria-label) and script does not throw when SpeechSynthesis is missing.

## G) Batch Preview

1. /preview/html with no URLs shows study placeholder and shadow-sentence placeholder only when mode is shadow.
2. /preview/html preserves manual audio directives in draft content.
3. Backward compatibility: existing payloads with only audioUrl still work.

## Rollout and Verification Steps

1. Implement package-level unit tests first (pmd, md-validator, tts-elevenlabs) to lock parser/contracts.
2. Implement orchestrator dual-artifact flow with mocks and smoke tests.
3. Implement Notion target-aware attachment and rerun compatibility.
4. Implement HTML word-TTS controls and preview route changes.
5. Run full checks: pnpm lint, pnpm test, pnpm -r build, pnpm smoke.
6. Validate one end-to-end dry run for each publish target (notion, anytype, html) using a fixture markdown with shadow mode.

## Assumptions and Defaults Chosen

1. Explicit mode marker is exactly shadow_sentence; only this enables pronunciation sentence audio generation.
2. Prompt snapshot IDs remain unchanged; templates are updated in place.
3. Manifest change is additive under schema version 1; no migration script required.
4. Word-level browser TTS is intentionally limited to HTML output and uses browser default voice selection policy with English preference.
5. Notion/Anytype do not get browser TTS for individual words; they receive the sentence reference audio only.
6. If shadow mode is absent, pronunciation artifact generation is skipped silently with stage-level skip telemetry.