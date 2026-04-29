# ElevenLabs TTS Strategy Design (Current)

This document describes the current “dual path” audio generation behavior in
`@esl-pipeline/tts-provider-elevenlabs`.

## Terminology

- **Study text content type** (from `@esl-pipeline/pmd`): `dialogue | monologue`
- **TTS strategy** (this package): `auto | dialogue | tts`
  - `dialogue`: ElevenLabs Text-to-Dialogue (typically uses `eleven_v3`)
  - `tts`: ElevenLabs Text-to-Speech (typically uses `eleven_multilingual_v2`)

## Strategy Selection

Inputs:

- `BuildStudyTextOptions.ttsStrategy?: 'auto' | 'dialogue' | 'tts'`
- `ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY` environment default (same values)

Rules:

1. `ttsStrategy === 'dialogue'` → always use Text-to-Dialogue.
2. `ttsStrategy === 'tts'` → always use Text-to-Speech.
3. `ttsStrategy === 'auto'`:
   - If **2+ distinct speakers** are present → use `dialogue`.
   - Otherwise, use sentence-length heuristics:
     - Many short sentences / “sentence-choppy” text → prefer `dialogue`.
     - Longer sentences / higher-level prose → prefer `tts`.

## Text Chunking (TTS path)

To avoid unnatural prosody resets and “speeding up” on simple text, the `tts` path synthesizes
larger text chunks instead of line-by-line, controlled by:

- `ELEVENLABS_TTS_MAX_CHARS` (default `4500`)

## Dialogue Preview Behavior

When `preview: true` and strategy resolves to `dialogue`, the package returns a deterministic
output path/hash **without calling ElevenLabs**, so callers can preview pipeline output paths
without an API key.

## Speaker → Voice Assignment

Voice assignment uses:

- `voices.yml` overrides (per-speaker / default)
- optional `speaker_profiles` metadata (gender/role/accent/style)
- a voice catalog (`packages/orchestrator/configs/elevenlabs.voices.json` or `ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH`)

### Gender policy (strict for explicit male/female)

When a speaker’s gender is explicitly set:

- `male` → prefer male; allow neutral only as fallback; **never choose female**
- `female` → prefer female; allow neutral only as fallback; **never choose male**
- `neutral` → prefer neutral best-effort; fall back to any gender if no neutral exists

If the catalog cannot satisfy a strict male/female requirement (and no override exists), the
package throws a configuration error instead of silently picking the opposite gender.

## Debug Logging

The package gates noisy strategy-selection logs behind:

- `ELEVENLABS_TTS_DEBUG=1` (or `ESL_TTS_DEBUG=1`)

## References

- SSOT: `docs/reference/agents-ssot.md`
- Runtime entrypoint: `packages/tts-provider-elevenlabs/src/index.ts`
