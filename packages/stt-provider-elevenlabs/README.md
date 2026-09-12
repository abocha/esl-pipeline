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
- signed URLs and provider responses are never logged. The worker may persist the complete raw
  response, including for URL-backed submissions, only when `ESL_STT_STORE_RAW_RESPONSE` is enabled.
- spacing is excluded from lexical turns; audio events are retained as `TranscriptSegment` values
  with `kind: 'non_speech'`. Their provider text, timestamps, and speaker attribution are kept when
  supplied, while missing event metadata remains missing. Non-speech events do not participate in
  lexical validation, speaker counting, speech-turn coalescing, or speaker-track metrics. Explicit
  punctuation tokens attach to the preceding lexical token. Other token types are treated as lexical.
  Finite, non-negative lexical
  timing, including point timing where `start === end`, is structurally usable; missing, non-finite,
  negative-start, and reversed timing stays visible to worker validation. Missing timestamps are not
  synthesized. Coalescing and sorting mean normalized segment indexes do not preserve provider word
  indexes (missing lexical starts sort as zero; missing event starts sort after timed segments).
- SDK 2.67.0 retains optional word start/end numbers and token kinds `word`, `spacing`,
  and `audio_event`. Its schema does not constrain duration or explain missing lexical timing for
  word-granularity Scribe v2. This alone does not justify repairing or dropping lexical text, or
  synthesizing timing; untimed and otherwise malformed lexical timing remains visible to worker
  validation.
- Before mapping or merging, lexical provider tokens are inspected into
  `summary.elevenLabsPreMergeTiming`: `indexBasis: provider_words_zero_based`, `lexicalTokenCount`,
  `invalidTimingTokenCount`, and (only if invalid) `firstInvalidTokenIndex` / `firstInvalidTimingIssue`.
  The index counts all entries in the SDK response's `words` array, including excluded token kinds.
  Only counts, an index, and controlled classifications are carried; no text, timestamps, or provider
  fields are copied. This is diagnostic metadata and does not change acceptance or retry behavior.
