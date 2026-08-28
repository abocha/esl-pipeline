# Local audio/STT benchmark harness

This directory is research tooling only. It is deliberately separate from the production STT
packages, provider registry, queue, jobs, database, recording routes, migrations, deployment files,
and public UI.

## Privacy boundary

Set `ESL_AUDIO_BENCHMARK_ROOT` to an existing directory outside this repository before using the CLI. The
manifest, source media, prepared media, raw provider responses, native segments, comparable
segments, run ledgers, and reports are written below that root. The harness refuses manifest paths
that escape it. Do not put private media, transcripts, API responses, credentials, or snapshots in
Git or CI.

Reports contain aggregate metrics and input hashes only; they do not read transcript artifacts when
building the report and never include verbatim transcript text.

## First-slice providers

The approved providers are:

| Provider                          | Benchmark request mode                       | Credential             | First-slice topology                     |
| --------------------------------- | -------------------------------------------- | ---------------------- | ---------------------------------------- |
| Soniox v5 Async                   | async file upload, submit, poll, result      | `SONIOX_API_KEY`       | mixed diarized                           |
| Speechmatics Melia 1 Batch        | multipart batch submit, poll, JSON v2 result | `SPEECHMATICS_API_KEY` | mixed diarized                           |
| Mistral Voxtral Mini Transcribe 2 | direct multipart transcription               | `MISTRAL_API_KEY`      | mixed diarized                           |
| Deepgram Nova-3                   | direct prerecorded binary request            | `DEEPGRAM_API_KEY`     | mixed diarized and trusted split control |
| ElevenLabs Scribe v2              | direct multipart transcription               | `ELEVENLABS_API_KEY`   | mixed diarized                           |

Mistral Batch, Inworld, Gemini, and all production provider registration are intentionally out of
scope.

## Output layers

Each successful run retains three separate layers under its private run directory:

1. `raw/*.response` keeps each provider HTTP response body as received. The final provider result is
   included in `run.json` through `rawResponsePaths`.
2. `native-segments.json` contains minimally parsed provider words or segments. Provider lexical
   content, timestamps, native speaker labels, language labels, and confidence values are retained
   where exposed.
3. `comparable-segments.json` is an explicitly derived view. It groups adjacent native items and
   adds stable anonymous keys (`S1`, `S2`, ...) within that result. It never maps speakers to
   Teacher or Student and never uses production text normalization. For example, provider-returned
   `ajá` remains `ajá`.

The derived view is a comparison convenience, not a production contract.

## Input and run modes

Manifest creation runs `ffprobe` against the exact source artifact and persists the observed
duration, channel count, sample rate, container, and codec where available. The CLI metadata flags
are assertions and a mismatch fails creation; they are not trusted source facts. The manifest stores
source SHA-256, source wall-clock duration, source channel count, and source metadata independently
from any prepared artifact. A `trusted_split_two_channel` case may be
prepared with the deterministic `pan=mono|c0=0.5*c0+0.5*c1` downmix into 16-bit PCM 16 kHz mono.
The original source remains unchanged.

`mixed_diarized` sends the prepared artifact. `trusted_split_control` sends the original two-channel
source and is currently available only for Deepgram with `multichannel=true`. These are distinct
run modes so topology, billable channels, usage, and cost are not conflated.
`original_source_compatibility` sends the original source for a direct media-ingest check and keeps
that observation separate from the comparative prepared-artifact lane.

Provider-specific cleanup, denoising, splitting, and resampling are not performed in the
comparative lane. The one controlled downmix is an explicit preparation artifact recorded in the
manifest and is not a provider-specific transformation.

Every physical HTTP request gets an attempt record and raw response artifact. There is no automatic
retry. A transport exception, relevant paid-request 5xx, or successful submission with an
unrecognized response is recorded as `uncertain`; definitely rejected 4xx responses remain
`failed`. An uncertain run fails closed, records any recoverable external ID, and stops. Recovery is
currently an operator/manual provider inspection boundary; there is no harness resume command.
Polling an already-created asynchronous job is recorded as separate `poll` attempts.

## Exact CLI workflow

The local prerequisites are Node 24+, `ffmpeg`, and `ffprobe` on `PATH` for preparation. The five
provider credentials are only needed for a later real run; dry-run does not call a provider.

```powershell
$env:ESL_AUDIO_BENCHMARK_ROOT = 'D:\private\esl-audio-benchmark'
New-Item -ItemType Directory -Force $env:ESL_AUDIO_BENCHMARK_ROOT | Out-Null
```

Create a case manifest. The `--file` path is relative to the external root (an absolute path inside
the root is also accepted). Metadata is intentionally explicit so the source wall-clock values are
not confused with provider usage.

```powershell
pnpm run audio-benchmark:manifest -- `
  --campaign 2026-08-first-slice `
  --case lesson-01 `
  --file corpus/lesson-01/source.wav `
  --topology trusted_split_two_channel `
  --wall-clock-duration-ms 3600000 `
  --channels 2 `
  --sample-rate-hz 48000 `
  --container wav `
  --codec pcm_s16le
```

Prepare the controlled downmix. This updates only the private manifest with the prepared artifact
fingerprint and metadata.

```powershell
pnpm run audio-benchmark:prepare -- `
  --manifest corpora/2026-08-first-slice/manifest.json `
  --case lesson-01
```

Dry-run one provider/case. It validates the manifest, selected input fingerprint, output paths,
credential presence (without printing the credential), and provider request intent. It makes zero
network requests.

```powershell
pnpm run audio-benchmark:run -- `
  --manifest corpora/2026-08-first-slice/manifest.json `
  --case lesson-01 `
  --provider soniox-v5-async `
  --mode mixed_diarized `
  --dry-run
```

Use `--mode original_source_compatibility` for a separate direct-ingest observation against the
unchanged source; it is not a quality comparison run.

Run one provider/case later, only after the consent-safe Gate 0 smoke. Use a new `--run-id` for an
explicit manual retry; the runner itself never retries.

```powershell
pnpm run audio-benchmark:run -- `
  --manifest corpora/2026-08-first-slice/manifest.json `
  --case lesson-01 `
  --provider soniox-v5-async `
  --mode mixed_diarized `
  --poll-interval-ms 5000 `
  --max-wait-ms 21600000 `
  --run-id soniox-lesson-01-attempt-001
```

Use the Deepgram split control as a separate run against the original source:

```powershell
pnpm run audio-benchmark:run -- `
  --manifest corpora/2026-08-first-slice/manifest.json `
  --case lesson-01 `
  --provider deepgram-nova-3 `
  --mode trusted_split_control `
  --run-id deepgram-lesson-01-split-control-001
```

Generate an aggregate-only report. Cost calculation is performed here, from the selected effective-
dated snapshot; request adapters do not contain prices. The report embeds the exact pricing content,
effective date, and canonical SHA-256 used for calculation. Existing report paths are not overwritten.
Provider-reported actual billing, when manually recorded in `run.json`, remains separate from
calculated estimates. Deepgram cost remains `unknown`/incomplete until Gate 0 confirms diarization
and split/multichannel billing semantics.

```powershell
pnpm run audio-benchmark:report -- `
  --campaign 2026-08-first-slice `
  --snapshot public-2026-08-28 `
  --output reports/2026-08-first-slice/public-2026-08-28.json
```

## Environment variables

CLI entrypoints load only `.env.audio-benchmark.local` from the repository root when that file is
present. Values already present in the process environment override values from that file. The
production `.env` file is never loaded implicitly, and credentials are never printed or persisted
as request evidence. Direct library calls should pass an explicit `environment` when they need
non-process values.

Required for every CLI command:

- `ESL_AUDIO_BENCHMARK_ROOT`: external private root for all corpus and run material.

Credentials required only for the corresponding later real run:

- `SONIOX_API_KEY`
- `SPEECHMATICS_API_KEY`
- `MISTRAL_API_KEY`
- `DEEPGRAM_API_KEY`
- `ELEVENLABS_API_KEY`

Optional endpoint overrides are useful for a controlled local HTTP integration test or provider
region selection. They are not needed for the public endpoints:

- `SONIOX_API_BASE_URL` (default `https://api.soniox.com/v1`)
- `SPEECHMATICS_API_BASE_URL` (default `https://eu1.asr.api.speechmatics.com/v2`)
- `MISTRAL_API_BASE_URL` (default `https://api.mistral.ai/v1`)
- `DEEPGRAM_API_BASE_URL` (default `https://api.deepgram.com/v1`)
- `ELEVENLABS_API_BASE_URL` (default `https://api.elevenlabs.io/v1`)

## Effective-dated public evidence

`data/public-provider-pricing.json` is the versioned effective-dated public contract/pricing
snapshot used by `report.ts` for its price entries. It records source URLs, observed contract
shapes, model, unit, and the usage field used for a calculation. Reports freeze the selected
snapshot by canonical hash and embedded content. Soniox token prices remain
unusable for calculation until raw token usage is present; the report returns `unknown` instead of
inferring token counts. Deepgram's estimate is explicitly incomplete and deliberately does not
silently include the separately listed diarization add-on or guess multichannel billing.

## Gate 0 assumptions still requiring a consent-safe live smoke

- Confirm each account's model access, regional endpoint, retention setting, response schema, and
  current billing metadata with one short synthetic or consent-safe file.
- Confirm Soniox upload, async submission, status, transcript token fields, and available usage
  metadata end-to-end.
- Confirm Speechmatics `data_file` multipart submission, `config` JSON encoding, selected region,
  Melia 1 access, and JSON v2 word/speaker output.
- Confirm Mistral `voxtral-mini-2602` access, direct multipart encoding, segment-only
  `timestamp_granularities` behavior, diarization/timestamp compatibility, and whether omitting
  `language` is required when timestamps are requested. Gate 0 observed that the multipart field
  encoding is accepted, while requesting both segment and word values returns HTTP 422 because the
  provider allows at most one item.
- Confirm Deepgram Nova-3 `language=multi`, `diarize_model=latest`, `filler_words`, and
  `multichannel=true` behavior plus actual billed channels.
- Confirm ElevenLabs Scribe v2 `timestamps_granularity=word`, `diarize=true`, `no_verbatim=false`,
  mixed-file limits, and whether the account exposes provider usage in the response.

No live campaign API call is part of this implementation.
