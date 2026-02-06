# Wizard TTS Strategy Design (Current)

This document describes the current TTS strategy UX and wiring in `@esl-pipeline/orchestrator`.
It intentionally replaces older “TTS mode” drafts. For authoritative contracts, defer to
`docs/reference/agents-ssot.md`.

## Terminology

- **Study text content type** (from `@esl-pipeline/pmd`): `dialogue | monologue`
- **TTS strategy** (what the pipeline actually does): `auto | dialogue | tts`
  - `dialogue`: ElevenLabs Text-to-Dialogue
  - `tts`: ElevenLabs Text-to-Speech (standard TTS)

The old “TTS mode” naming is removed; `monologue` is not a strategy value.

## User-Facing Configuration

### Wizard state keys

- `withTts: boolean`
- `ttsStrategy: 'auto' | 'dialogue' | 'tts'`
- Dialogue-specific options (only meaningful for `ttsStrategy === 'dialogue'`):
  - `dialogueLanguage?: string` (ISO 639-1, best effort)
  - `dialogueStability?: number` (0.0–1.0)
  - `dialogueSeed?: number` (integer)

### CLI flags

- `--with-tts`
- `--tts-strategy <auto|dialogue|tts>`
- `--dialogue-language <xx>`
- `--dialogue-stability <0..1>`
- `--dialogue-seed <int>`

### Environment variables

- `ELEVENLABS_TTS_STRATEGY=auto|dialogue|tts`
- `ELEVENLABS_DIALOGUE_LANGUAGE=xx`
- `ELEVENLABS_DIALOGUE_STABILITY=0.0..1.0`
- `ELEVENLABS_DIALOGUE_SEED=int`

## Selection Rules

1. **Explicit override wins**:
   - CLI / wizard option `ttsStrategy` overrides environment defaults.
2. **`auto`** uses heuristics in `@esl-pipeline/tts-elevenlabs`:
   - Multi-speaker content selects `dialogue`.
   - Single-speaker content selects `dialogue` when the text is “sentence-choppy / low-level”
     (many short sentences), otherwise selects `tts`.

## Pipeline Integration

The orchestrator forwards the wizard/CLI options to the TTS package via `buildStudyTextMp3(...)`.

## Persistence

Wizard defaults persist `ttsStrategy` and dialogue fields (when set) alongside other run defaults.

## Notes

- This repo is private and does not preserve backward compatibility: legacy “TTS mode” flags/env
  are intentionally not supported.
- Keep the batch backend/frontend naming aligned with contracts:
  - `JobStatusDto.ttsStrategy`
  - Job-options payload: `ttsStrategies`
