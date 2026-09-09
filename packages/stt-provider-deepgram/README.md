# @esl-pipeline/stt-provider-deepgram

Deepgram adapter for `@esl-pipeline/stt-core`.

Behavior:

- explicit `trusted_split_channels` recordings use one multichannel request
- the response must preserve exactly two channels and both tutor/student channel roles
- no hidden diarization retry or cross-provider fallback; the durable run owns bounded recovery
- normalized transcript segments for timeline/stack formatting
