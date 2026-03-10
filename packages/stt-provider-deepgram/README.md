# @esl-pipeline/stt-provider-deepgram

Deepgram adapter for `@esl-pipeline/stt-core`.

Behavior:

- multichannel-first transcription
- diarized fallback when primary fails or collapses to one channel
- normalized transcript segments for timeline/stack formatting
