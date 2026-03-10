# @esl-pipeline/stt-provider-elevenlabs

ElevenLabs STT adapter for `@esl-pipeline/stt-core`.

Behavior:

- `scribe_v2` model
- multichannel-first transcription
- diarization fallback when multichannel fails or is unavailable
- robust speaker parsing (`speakerId`/`speaker_id`, `channelIndex`/`channel_index`)
