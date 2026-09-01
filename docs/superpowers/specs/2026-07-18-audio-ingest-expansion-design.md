# Audio Ingest Expansion Design

## Meta

- Audience: founder-maintainer, agentic implementers, speech-runtime maintainers, and alpha UX reviewers.
- Authority Level: superseded historical design direction.
- Last Verified Against: superseded on 2026-09-01 by the approved ordinary-ingest Goal Contract.
- Owner: founder-maintainer.
- Review Cadence: after each ingest slice or material STT-provider decision.
- Status: `superseded`.
- Related issue: `#145` for Deepgram versus Inworld production quality and cost.
- Exit Trigger: historical trace; remaining ingest work is owned by [`2026-09-01-normal-user-audio-ingest-readiness.md`](../../plans/stt-multi-provider-refactor/2026-09-01-normal-user-audio-ingest-readiness.md).

> Superseded scope: retain this document for problem framing and provenance only. The 2026-09-01
> active plan replaces its generalized normalization, topology-inference, provider-evaluation, and
> broad source-expansion machinery with the locked ElevenLabs mixed route, explicit trusted split,
> bounded probe/copy preparation, tenant isolation, retry claiming, and audio disposal.

## Purpose

Define a durable product and technical boundary for accepting realistic lesson recordings without requiring every tutor to configure OBS, use headphones, and manufacture one exact stereo Opus file.

The design keeps the existing downstream transcription and assignment pipeline, but moves capture-specific complexity into an explicit ingest layer.

## Problem

The current product begins after the hardest adoption work has already happened:

1. the tutor configures OBS;
2. microphone and remote lesson audio are routed into known channels;
3. the tutor uses headphones to avoid speaker leakage;
4. a specifically shaped Opus recording is uploaded;
5. the existing queue-backed STT pipeline begins.

This path is technically clean and remains a useful high-confidence control, but it is not a credible default for broad tutor adoption. Tutors use a changing mix of Yandex Telemost, Microsoft Teams, Zoom, Google Meet, Livedigital, Jitsi, and other tools. Russian access conditions make platform availability unstable, so the product must not depend on one conferencing platform.

## Goal

Let a tutor provide whatever recording their normal lesson setup naturally produces, while ESL Pipeline:

- preserves the original source;
- safely inspects and normalizes common audio/video containers;
- determines which speaker-separation evidence exists;
- applies the least destructive valid processing route;
- records provenance and processing decisions;
- sends a suitable artifact to the selected STT provider;
- produces the same canonical speaker-labelled transcript contract used by the current assignment flow.

The product promise becomes:

> Use the recording your lesson setup naturally produces. ESL Pipeline handles the audio plumbing.

## Current State

The active system already provides valuable foundations:

- authenticated single-file upload through `/recordings/upload`;
- upload validation, filename sanitization, storage, SHA-256 fingerprinting, and provider-aware transcript cache reuse;
- queue-backed transcription;
- provider-agnostic `stt-core` with Deepgram, ElevenLabs Scribe v2, and Google Cloud STT V2 adapters;
- explicit provider selection with no silent cross-provider fallback;
- Deepgram multichannel-first behavior with diarization fallback for one-channel results;
- canonical transcript formatting, optional raw response storage, and derived speaker-track transcript artifacts;
- transcript review/edit/save;
- manual pasted transcript ingestion that bypasses audio and STT.

The missing layer is media preparation. Uploaded bytes currently flow largely unchanged into the selected STT adapter. There is no general-purpose video demux, audio normalization, related-file-set ingestion, topology classification, offline acoustic echo cancellation, or platform-specific source recognition.

## Chosen Approach

Adopt a source-agnostic ingest layer before STT.

Do not choose a single meeting platform as the product boundary. Do not start by building a native recorder. Do not replace the current OBS path.

Instead:

1. retain current split-channel Opus as the trusted control path;
2. add a safe research and benchmark harness using non-committed lesson media;
3. add common media inspection and normalization;
4. classify each input into a small set of evidence-based topologies;
5. route each topology through the least destructive preparation strategy;
6. benchmark Deepgram and Inworld on the resulting realistic input matrix;
7. expose only proven input paths to alpha tutors;
8. decide later whether platform imports or a desktop capture helper are still necessary.

## Architecture

```text
Tutor-provided source
  ├─ current split-channel recording
  ├─ platform-native recording
  ├─ separate participant tracks
  ├─ microphone + far-end playback reference
  ├─ ordinary mixed audio/video
  └─ pasted transcript
                |
                v
Source registration and immutable originals
                |
                v
Media probe and normalization
  ├─ container/codec/stream inspection
  ├─ audio extraction from video
  ├─ controlled PCM working format
  ├─ timestamp preservation
  └─ file-set alignment metadata
                |
                v
Topology classification
  ├─ trusted_split_channels
  ├─ separate_participant_tracks
  ├─ mic_plus_far_end_reference
  ├─ mixed_recording
  └─ manual_transcript
                |
                v
Topology-specific preparation
  ├─ direct channel mapping
  ├─ participant-track alignment
  ├─ delay/drift estimation + offline AEC
  ├─ provider diarization
  └─ bypass audio/STT
                |
                v
Explicit STT provider
  ├─ Deepgram
  ├─ ElevenLabs
  ├─ Google
  └─ Inworld only after its provider contract and benchmark path are reviewed
                |
                v
Canonical speaker-labelled transcript
                |
                v
Existing review → context → prompt → draft → publish flow
```

## Core Boundaries

### 1. Original Source Boundary

Every accepted source is stored immutably before derived processing begins.

The original source is never overwritten by normalized or cleaned audio. Reprocessing must be possible when normalization, AEC, or STT behavior changes.

Private lesson audio and verbatim transcripts must not be committed to Git. Repository fixtures use generated audio, consent-safe reenactments, or manifests containing hashes and non-sensitive metadata.

### 2. Media Probe Boundary

A media probe describes observed facts without making product decisions.

```ts
export interface MediaProbe {
  container: string | null;
  durationMs: number;
  formatBitRate: number | null;
  streams: MediaStreamProbe[];
}

export interface MediaStreamProbe {
  index: number;
  kind: 'audio' | 'video' | 'other';
  codec: string | null;
  channels: number | null;
  channelLayout: string | null;
  sampleRateHz: number | null;
  startTimeMs: number | null;
  durationMs: number | null;
}
```

Probe output is deterministic for the same bytes and tool version. Raw `ffprobe` output may be retained as diagnostic metadata, but application code consumes the normalized type.

### 3. Normalized Media Boundary

Normalization prepares media for analysis and provider submission without claiming speaker identity.

```ts
export interface NormalizedMediaArtifact {
  artifactId: string;
  sourceArtifactIds: string[];
  storageUri: string;
  sha256: string;
  container: 'wav';
  codec: 'pcm_s16le';
  sampleRateHz: 16000 | 48000;
  channels: 1 | 2;
  durationMs: number;
  normalizationVersion: string;
}
```

The initial working format is PCM WAV because it is inspectable and broadly accepted by audio tooling. Provider-specific encoding optimization may occur only after benchmark evidence shows a material storage or transfer benefit.

### 4. Topology Boundary

Topology is an evidence claim, not a filename guess.

```ts
export type AudioInputTopology =
  | 'trusted_split_channels'
  | 'separate_participant_tracks'
  | 'mic_plus_far_end_reference'
  | 'mixed_recording'
  | 'manual_transcript';

export interface TopologyDecision {
  topology: AudioInputTopology;
  confidence: 'explicit' | 'strong' | 'weak';
  evidence: string[];
  requiresTutorConfirmation: boolean;
}
```

Automatic classification may use explicit upload mode, number of related files, channel count, platform metadata, and capture-helper manifests. Filename patterns alone may suggest but never prove speaker roles.

When identity is ambiguous, the tutor must confirm roles or the pipeline must treat the source as mixed.

### 5. Prepared STT Boundary

STT adapters receive a prepared input plus declared speaker semantics.

```ts
export interface PreparedSttInput {
  storageUri: string;
  sha256: string;
  durationMs: number;
  topology: AudioInputTopology;
  speakerMode: 'channel_roles' | 'provider_diarization' | 'single_speaker';
  channelRoles?: Array<{
    channel: number;
    role: 'tutor' | 'student' | 'unknown';
  }>;
  preparationVersion: string;
}
```

This extends media provenance without making provider selection automatic. The requested/configured provider remains authoritative.

### 6. Canonical Transcript Boundary

Downstream assignment code continues to consume transcript text and speaker-labelled segments, independent of source container and preparation path.

The ingest program should not redesign prompt packaging, transcript editing, assignment generation, or publishing.

## Topology Routes

### Trusted Split Channels

Examples:

- current OBS stereo Opus;
- a future helper-produced two-channel file with explicit role metadata.

Processing:

- validate channel count;
- preserve or normalize channels;
- map explicit tutor/student roles;
- send as multichannel when the provider supports the required semantics;
- do not add diarization unless the explicit route fails validation and the tutor chooses a mixed-audio fallback.

Expected quality: reference control and highest-confidence identity.

### Separate Participant Tracks

Examples:

- one audio file per meeting participant;
- a platform export directory.

Processing:

- register all related originals;
- probe each track;
- estimate common start and duration;
- align using timestamps or cross-correlation where required;
- retain overlap;
- map identities explicitly;
- render a provider-compatible multichannel artifact or transcribe tracks separately and merge timestamps.

Expected quality: potentially equal to or better than current OBS without headphone requirements.

### Microphone Plus Far-End Reference

Examples:

- tutor microphone track;
- clean application/system playback track containing the student.

Processing:

- normalize both tracks;
- estimate initial delay;
- track clock drift;
- run offline acoustic echo cancellation;
- preserve double-talk;
- treat the far-end reference as the student stream;
- treat the cleaned microphone as the tutor stream;
- retain originals and AEC diagnostics;
- reject the cleaned artifact when objective checks or listening review show tutor-speech damage.

Expected quality: the most promising route to remove both OBS configuration and mandatory headphones.

### Mixed Recording

Examples:

- Telemost WebM;
- Teams/Zoom/Meet recording without isolated participants;
- ordinary mono or stereo lesson recording.

Processing:

- extract and normalize audio;
- use provider diarization when available;
- retain anonymous speaker labels until the tutor or downstream rules map roles;
- expose low-confidence or unstable speaker assignment honestly.

Expected quality: lowest setup friction, but quality depends most heavily on provider diarization, acoustics, and overlap.

### Manual Transcript

Existing behavior remains unchanged. It bypasses media processing and STT while preserving manual provenance.

## Failure and Recovery

The ingest layer must fail with bounded, actionable states:

- unsupported or corrupt media;
- no usable audio stream;
- ambiguous related-file set;
- duration or size limit exceeded;
- normalization timeout;
- missing media tool;
- topology requires confirmation;
- AEC alignment failure;
- AEC quality regression;
- provider rejection;
- provider timeout or quota failure.

A failure never deletes the original source. Retrying a deterministic preparation version reuses existing successful derived artifacts. Reprocessing with a new preparation version creates a new derived artifact rather than mutating the old one.

No topology route silently falls back to a materially different interpretation. A failed mic-plus-reference AEC attempt may offer a mixed-recording route, but that choice is explicit and provenance records the change.

## Privacy and Consent

- Recording consent remains a tutor responsibility and must be reflected in onboarding/help copy before broader rollout.
- The product must display that audio is uploaded to ESL Pipeline and may be sent to the selected STT provider.
- Original and derived audio retention must be configurable before public beta.
- Benchmark media stays outside Git and outside CI artifacts.
- Benchmark reports must avoid verbatim private transcript passages.
- Raw provider responses may contain transcript content and follow the same retention policy as transcripts.
- A future platform integration or meeting bot requires a separate privacy/security design.

## Evaluation Strategy

Quality is evaluated per capture topology, not only per provider.

The frozen evaluation matrix should include:

- current trusted split stereo;
- platform-native mixed WebM/MP4/M4A;
- separate participant tracks;
- microphone plus far-end reference with speakers;
- difficult code-switching and non-native speech;
- interruptions and overlapping speech;
- clean and noisy conditions.

Metrics include:

- word-level edit metrics on reviewed spans;
- language-switch preservation;
- names, numbers, grammar terminology, negation, tense, and modality;
- preservation of learner mistakes and teacher corrections;
- severe pedagogical error count;
- speaker-role stability;
- downstream teaching-point and assignment usefulness;
- successful cost per audio hour;
- median and tail latency;
- retries/failures;
- manual repair minutes.

Promotional credits are excluded from steady-state production comparisons.

## Delivery Slices and Gates

| Slice | Deliverable                                                      | Gate to continue                                                          |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 0     | Consent-safe corpus and baseline manifests                       | Representative source material exists outside Git                         |
| 1     | Reproducible media probe/normalization harness                   | Common sample formats normalize deterministically                         |
| 2     | Provider benchmark harness including Inworld evaluation path     | Same immutable inputs produce comparable quality/cost records             |
| 3     | Topology contract and preparation router behind internal tooling | Current OBS path remains unchanged and all routes preserve provenance     |
| 4     | Offline AEC feasibility experiment                               | Echo reduction improves STT without unacceptable tutor-speech loss        |
| 5     | Universal alpha upload for proven formats/routes                 | Alpha tutors can use normal platform files with bounded errors            |
| 6     | Production provider decision                                     | Deepgram/Inworld decision recorded from real ESL evidence                 |
| 7     | Capture automation decision                                      | Build platform import/helper only if residual tutor friction justifies it |

Each slice can stop the program. A failed AEC gate does not block universal mixed-file ingestion. An Inworld loss does not block media normalization. A platform changing access conditions does not invalidate the source-agnostic architecture.

## Success Criteria

The first production milestone succeeds when:

- at least one non-OBS, non-manual source path works end to end;
- a tutor can upload a natural platform recording without codec configuration;
- the system explains what it detected and what it will do;
- the resulting transcript is usable for assignment creation without routine manual audio repair;
- original media and processing provenance are retained;
- current split-channel uploads remain compatible;
- STT cost and quality are measurable per successful audio hour;
- failures are actionable and do not strand the assignment flow.

The broader adoption milestone succeeds when:

- headphones are optional for a proven mic-plus-reference capture path or platform-isolated tracks;
- median tutor effort from lesson end to transcription start is under two minutes;
- at least 80% of representative alpha recordings complete without founder intervention;
- transcript correction effort does not materially exceed the current split-channel baseline;
- the selected provider economics are acceptable without promotional credits.

## Non-Goals

- Choosing one conferencing platform as mandatory.
- Building a meeting bot during closed alpha.
- Building a native recorder before ingestion evidence shows it is necessary.
- Real-time transcription.
- Generic audio restoration.
- Automatic provider switching after runtime failure.
- Replacing the current transcript, prompt, draft, or publish model.
- Committing private lesson media or verbatim evaluation transcripts.
- Supporting every container, codec, and platform in the first rollout.
