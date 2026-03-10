# @esl-pipeline/stt-provider-google

Google Cloud STT V2 adapter for `@esl-pipeline/stt-core`.

Behavior:

- multichannel-first recognition
- diarization fallback
- required GCS staging bucket for non-`gs://` source URIs
- normalized segment extraction for timeline/stack formatting
