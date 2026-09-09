# @esl-pipeline/stt-provider-elevenlabs

ElevenLabs STT adapter for `@esl-pipeline/stt-core`.

Behavior:

- `scribe_v2` model
- one diarized request for ordinary mixed recordings (`useMultiChannel: false`, two speakers)
- S3 sources use a fresh storage-owned `sourceUrl`, serialized by the installed SDK as `source_url`
- filesystem sources stay file-backed with their probed MIME type and filename; there is no
  whole-file Buffer collector
- SDK retries are disabled; the durable transcription run owns bounded recovery and reservations
- robust speaker parsing (`speakerId`/`speaker_id`, `channelIndex`/`channel_index`)
- signed URLs and URL-backed raw provider responses are not logged or persisted
