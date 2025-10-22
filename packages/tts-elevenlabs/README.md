# @esl-pipeline/tts-elevenlabs

Stub wrapper for converting `:::study-text` content into MP3 assets using ElevenLabs.  
The current implementation only calculates a deterministic hash, writes an empty placeholder file (unless `--preview` is passed), and returns metadata so later pipeline steps can proceed.

## CLI

```
pnpm cli:tts --md lesson.md --voice-map ./configs/voices.yml --out ./out [--preview]
```

Outputs JSON containing the destination path and hash. No real ElevenLabs API calls are made yet.

## TODO

- Parse the Markdown to extract study text content.
- Call the ElevenLabs API using `ELEVENLABS_API_KEY`.
- Surface audio duration and error handling details.
