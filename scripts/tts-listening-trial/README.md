# TTS listening trial

Isolated live-provider research for ABO-33 and ABO-59. This directory does not register a provider,
change the orchestrator, load learner data, upload audio, or change production routing.

## Listen to the prepared run

From the repository root:

```powershell
node scripts/tts-listening-trial/report.mjs --serve
```

Open <http://127.0.0.1:8794>. The page includes transcripts, independently playable loudness-adjusted
MP3s, original WAV downloads, measured request/assembly timings and list-price cost estimates.
Notes stay in browser local storage and can be downloaded. The server binds only to loopback and
serves only the generated page and its named audio files, never `.env` or the repository tree.

Generated files live in Git-ignored `tmp/tts-listening-trial/`. Keep that directory to retain the
audio; regenerating the page does not call providers. `results.json` contains the report's costs,
recalculated using the audio-specific token count rather than the combined candidate token count.

## Reproduce the provider calls

These commands make billable calls. Requirements: Node 24+, `gcloud` authenticated to the intended
account, the existing Inworld workspace dependency, and `ffmpeg`/`ffprobe` on `PATH`. Inworld reads
only the API key from the repository-root `.env` using Node's parser; it does not apply that file
to the process environment. Google uses the CLI's short-lived bearer token in memory, independently
of the `.env` Google credentials. No tokens or keys are persisted in the run artifacts.

```powershell
node scripts/tts-listening-trial/run.mjs --provider=google --project=esl-pipeline-production --sample=dialogue
node scripts/tts-listening-trial/run.mjs --provider=google --project=esl-pipeline-production
node scripts/tts-listening-trial/run.mjs --provider=inworld
node scripts/tts-listening-trial/run.mjs --provider=google --project=esl-pipeline-production --sample=dialogue --model=gemini-3.8-flash-lite-tts
node scripts/tts-listening-trial/report.mjs --serve
```

`--out=PATH` chooses a different output directory on both scripts. Successful metadata records
prevent repeat charges on a rerun; use a new output directory for a fresh experiment. Failed partial
runs are not resumed turn by turn and can incur repeat charges if explicitly rerun. The runner has
no automatic retry loop. Keep the fixed synthetic sample set small; this is not a load test.

Google uses the global `aiplatform.googleapis.com` `generateContent` endpoint with one request per
passage. Dialogues pass speaker metadata and fixed Puck/Kore voices. No style instructions are sent.
The native unary WAV is preserved. Inworld uses its installed official SDK with `inworld-tts-2`,
Dennis/Ashley, `BALANCED`, MP3/24 kHz, plain text and no speaking-rate override. Each turn is
synthesized independently, then assembled with 320 ms speaker-switch gaps. Listening copies apply
the same FFmpeg loudness target (`I=-18`, `TP=-1.5`, `LRA=11`) and MP3 encoding to both providers.

## Interpretation and remaining decisions

- The shared input hash proves each comparison uses identical authored words and speaker mapping.
  It does not prove the output spoken words match: listen against the transcript for omissions,
  additions, stress and pronunciation.
- This compares plain provider output with fixed voices. It does **not** reproduce the full current
  Inworld + OpenAI speech-planner/voice-ranker path, so it cannot establish that either stage can be
  removed. Current `.env` enables both stages; a later production-shaped comparison must account for
  them if the listening result justifies integration.
- One sample per condition gives initial listening evidence, not a reliability or latency benchmark.
  Generation timings exclude the final listening conversion, but include Inworld per-turn conversion
  and assembly; credential initialization is excluded. Voices and APIs are different across providers.
- Google estimates use reported AUDIO output tokens at $9/million for Flash or $6/million for
  Flash-Lite, plus reported text input at $0.50/million through 2026-12-31. Published 2027 rates double
  those components. Ancillary TEXT output has no listed rate in this estimate. Inworld estimates
  use $25/million authored characters; confirm account-specific pricing before adoption.
- The Cloud API was enabled on `esl-pipeline-production` for this authorized experiment. Production
  application configuration and routing were not changed. The credits page showed available trial
  credit ending **2027-01-19**, starting **2026-10-20**. Both actual Billing Reports and Live costs by
  SKU showed no posted usage when checked. **Specific SKU credit application remains unverified.**
  Do not treat the list-price estimates as invoices or proof of credit coverage.
- Human listening is the next decision: keep Inworld, investigate a Gemini adapter, or compare the
  full planned stack. No provider adoption or planner/ranker retirement is implied by these clips.

References: [ABO-33](https://linear.app/abocha/issue/ABO-33),
[ABO-59](https://linear.app/abocha/issue/ABO-59),
[Cloud Gemini TTS guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/text-to-speech/overview),
[Google pricing](https://cloud.google.com/text-to-speech/pricing),
[Inworld pricing](https://inworld.ai/tts).
