# Audio Ingest Expansion Program Implementation Plan

> **Superseded 2026-09-01:** This historical program plan is not executable. The locked production
> provider/topology decisions and remaining work are owned by
> [`2026-09-01-normal-user-audio-ingest-readiness.md`](../../plans/stt-multi-provider-refactor/2026-09-01-normal-user-audio-ingest-readiness.md).
> Retain this file for research and decision provenance; do not implement its generalized
> normalization, automatic topology work, provider evaluation, or mandatory per-slice PR structure.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and validate a source-agnostic lesson-audio ingest layer that accepts realistic tutor recordings, preserves provenance, produces provider-ready audio, and removes OBS-specific file preparation from the normal alpha workflow.

**Architecture:** Keep the existing recording, queue, STT adapter, transcript, and assignment pipeline as the stable downstream boundary. Add research tooling first, then a media probe/normalization boundary, explicit topology classification, topology-specific preparation, and only the proven alpha upload routes. Treat provider choice, AEC, and capture automation as independent evidence-gated decisions.

**Tech Stack:** TypeScript 6, Node.js 24, pnpm workspace packages, Fastify, PostgreSQL, Redis-backed transcription queue, existing transcription storage adapters, FFmpeg/ffprobe CLI, Vitest, React, Playwright/manual sandbox checks, Deepgram and Inworld batch STT APIs.

## Global Constraints

- Preserve the current OBS split-channel Opus path throughout the program.
- Preserve manual transcript ingestion and its `manual` provenance.
- Store original source media immutably; derived media never overwrites an original.
- Keep private lesson audio, raw transcripts, and raw provider responses out of Git and CI artifacts.
- Do not select or fall back to another STT provider implicitly.
- Do not expose a production route until its source formats, limits, errors, and recovery behavior are tested.
- Do not build a native recorder, browser extension, meeting bot, or deep platform integration before Slice 7.
- Use explicit preparation and benchmark version identifiers so results remain reproducible.
- Treat filename patterns as hints, never authoritative speaker identity.
- Require tutor confirmation when speaker roles or related-file grouping are ambiguous.
- Preserve the existing canonical transcript and assignment-flow contracts.
- Promotional credits may be reported as current cash relief but are excluded from steady-state provider economics.
- Keep raw benchmark media outside the repository under a maintainer-controlled directory defined by `ESL_AUDIO_BENCHMARK_ROOT`.
- Every implementation slice ends in a separately reviewable PR and may be stopped without blocking independent later value.

---

## Program Shape

This document is the master execution plan. The program crosses research tooling, backend media processing, provider evaluation, data contracts, and frontend UX. To keep reviews bounded, each slice produces working evidence or software and then opens a child implementation plan before the next slice begins.

| Slice                          | Primary owner                                  | Review unit                                | Expected outcome                                                |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| 0. Evidence pack               | Maintainer + agent                             | Docs/tooling PR                            | Frozen consent-safe corpus manifest and baseline                |
| 1. Probe and normalize         | Agent                                          | Package PR                                 | Deterministic inspection and normalized WAV artifacts           |
| 2. Benchmark providers         | Agent + maintainer scoring                     | Tooling/provider PR                        | Comparable Deepgram/Inworld quality, latency, and cost evidence |
| 3. Topology contracts          | Agent                                          | Contracts/backend PR                       | Explicit provenance and internal preparation router             |
| 4. AEC feasibility             | Agent experiment + maintainer listening review | Research PR                                | Evidence whether speakers can replace headphones                |
| 5. Universal alpha upload      | Agent + alpha tutors                           | Backend/frontend PR                        | Natural platform recordings accepted for proven paths           |
| 6. Provider decision           | Maintainer                                     | Decision docs + bounded adapter/cutover PR | Deepgram/Inworld production recommendation                      |
| 7. Capture automation decision | Maintainer + alpha tutors                      | Design/plan PR                             | Evidence-backed decision on platform imports or desktop helper  |

## Required Source Material

The maintainer supplies these outside Git before Slice 0 can close:

1. **Current control**
   - one current OBS split-channel Opus recording;
   - the exact OBS channel-role convention;
   - a short note identifying tutor and student channels.

2. **Platform-native recordings**
   - at least one untouched Yandex Telemost WebM;
   - at least one Teams, Zoom, Meet, or Livedigital recording when available;
   - the platform name, capture date, operating system, and whether headphones or speakers were used.

3. **Separate-track samples**
   - one lesson-style call with microphone and far-end/system playback captured separately;
   - one section containing tutor-only speech;
   - one containing student-only speech;
   - one interruption/double-talk section;
   - one section with louder speaker leakage.

4. **Reference annotations**
   - reviewed transcript spans rather than complete lessons where privacy is preferable;
   - speaker role;
   - language per span;
   - learner errors that must remain uncorrected;
   - teacher corrections;
   - names, numbers, negation, grammar terminology, and code-switches.

5. **Commercial evidence**
   - dated official pricing snapshots or notes for evaluated Deepgram and Inworld models;
   - billed usage exports after test runs where the provider exposes them;
   - promotional-credit balance recorded separately.

6. **Consent and retention**
   - confirmation that each real sample may be used for private product evaluation;
   - deletion date or retention decision for the local corpus;
   - anonymized corpus IDs that do not contain student names.

Synthetic or reenacted samples are acceptable for automated regression fixtures. Real lesson material is still required for the final quality decision.

## Human-Only Decisions

Agents must not decide these without maintainer review:

- whether a recording is consent-safe;
- whether an anonymized transcript still exposes sensitive information;
- tutor/student role labels for ambiguous recordings;
- whether AEC damaged important tutor speech;
- pedagogical severity of transcript errors;
- acceptable correction time;
- provider commercial selection;
- retention period;
- whether tutor friction justifies a desktop helper or platform integration.

## Delegation Model

### Safe to delegate to agents

- repository inventory and contract mapping;
- fixture generators for non-sensitive synthetic audio;
- ffprobe parsing and schema tests;
- deterministic normalization commands;
- checksum and artifact-manifest generation;
- benchmark orchestration;
- cost/latency aggregation;
- anonymized HTML/Markdown report generation;
- provider adapter scaffolding after the API contract is captured;
- backend routing and persistence code;
- frontend upload-state implementation;
- automated tests, documentation updates, and narrow refactors required by touched code.

### Agent work requiring maintainer checkpoints

- current official provider API/pricing capture;
- real-corpus run initiation;
- human-reference alignment;
- AEC listening samples;
- severe-error classification;
- enabling new formats for alpha tutors;
- provider cutover;
- data-retention defaults.

### Do not delegate unattended

- uploading private recordings to a new provider;
- sharing raw benchmark artifacts through CI;
- deleting the only copy of source media;
- changing the production STT default;
- installing a capture helper on tutors' computers;
- interpreting consent.

## Blockers and Pre-Decisions

| Blocker                                                                  | Consequence                                                     | Resolution gate                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| No consent-safe representative corpus                                    | Generic benchmarks cannot establish ESL usefulness              | Slice 0 cannot close                                                                 |
| Inworld request/response and billing contract may change                 | Premature production adapter may encode stale assumptions       | Capture dated official contract before Slice 2 implementation                        |
| FFmpeg/ffprobe runtime availability may differ locally and in containers | Normalization can work locally but fail in production           | Slice 1 adds explicit capability checks and container tests                          |
| Long recordings may exceed current upload size/time limits               | Universal formats may appear supported but fail on real lessons | Slice 1 records realistic bytes/duration; Slice 5 sets tested limits                 |
| AEC native/tooling choice is unresolved                                  | Packaging may dominate the experiment                           | Slice 4 starts as an offline harness and compares bounded candidates                 |
| Speaker identity is absent in ordinary mixed recordings                  | Transcript labels may be unstable                               | UI remains explicit about unknown speakers; tutor confirmation required where needed |
| Platform access in Russia changes                                        | Platform-specific product logic can decay rapidly               | Platform recognition remains advisory; common media is the durable contract          |
| Storage and retention policy is not yet public-beta ready                | Raw and derived audio may accumulate indefinitely               | Slice 5 requires explicit retention/operator policy                                  |
| Provider quality may vary by topology                                    | One global winner may not exist                                 | Slice 2 reports per-topology outcomes; routing remains explicit                      |

## Planned File Structure

### Slice 0 and 2 research tooling

- Create: `scripts/audio-benchmark/README.md` - private-corpus handling and operator commands.
- Create: `scripts/audio-benchmark/schema.ts` - manifest and result schemas.
- Create: `scripts/audio-benchmark/manifest.ts` - manifest validation and checksum verification.
- Create: `scripts/audio-benchmark/run.ts` - selected-case orchestration.
- Create: `scripts/audio-benchmark/report.ts` - anonymized report generation.
- Create: `scripts/audio-benchmark/providers/types.ts` - benchmark-only provider interface.
- Create: `scripts/audio-benchmark/providers/deepgram.ts` - Deepgram runner using the active configuration.
- Create after contract capture: `scripts/audio-benchmark/providers/inworld.ts` - Inworld runner isolated from production registration.
- Create: `scripts/audio-benchmark/fixtures/generate-synthetic-audio.ts` - non-sensitive regression media.
- Create: `scripts/audio-benchmark/tests/*.test.ts` - schema, checksum, orchestration, and report tests.
- Modify: `package.json` - benchmark scripts.
- Modify: `.gitignore` - private corpus/output directories.
- Modify: `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md` only after a production ingest route ships.

### Slice 1 media package

- Create: `packages/media-ingest-core/package.json`.
- Create: `packages/media-ingest-core/tsconfig.json`.
- Create: `packages/media-ingest-core/src/types.ts`.
- Create: `packages/media-ingest-core/src/probe.ts`.
- Create: `packages/media-ingest-core/src/normalize.ts`.
- Create: `packages/media-ingest-core/src/process-runner.ts`.
- Create: `packages/media-ingest-core/src/index.ts`.
- Create: `packages/media-ingest-core/tests/probe.test.ts`.
- Create: `packages/media-ingest-core/tests/normalize.test.ts`.
- Create: `packages/media-ingest-core/tests/process-runner.test.ts`.
- Modify: backend production Dockerfile(s) only if ffprobe/FFmpeg are not already present in the runtime image.
- Modify: production-image contract tests to assert required media binaries when Slice 5 uses them in production.

### Slice 3 backend contracts

- Modify: `packages/contracts/src/index.ts` - ingest topology and provenance DTOs.
- Create: `packages/batch-backend/src/application/media-ingest/topology.ts`.
- Create: `packages/batch-backend/src/application/media-ingest/prepare.ts`.
- Create: `packages/batch-backend/src/application/media-ingest/artifact-repository.ts`.
- Create: `packages/batch-backend/tests/application.media-ingest.topology.test.ts`.
- Create: `packages/batch-backend/tests/application.media-ingest.prepare.test.ts`.
- Add a migration and baseline updates only after the persistence shape is confirmed by Slice 1 evidence.
- Modify: `packages/batch-backend/src/application/process-transcribe-job.ts` to consume a prepared artifact only when a feature-gated ingest record exists; preserve current direct-recording behavior otherwise.

### Slice 4 AEC research

- Create: `scripts/audio-benchmark/aec/types.ts`.
- Create: `scripts/audio-benchmark/aec/align.ts`.
- Create: `scripts/audio-benchmark/aec/run-candidate.ts`.
- Create: `scripts/audio-benchmark/aec/metrics.ts`.
- Create: `scripts/audio-benchmark/tests/aec.*.test.ts`.
- Add a selected AEC implementation dependency or executable only in the research harness until the gate passes.

### Slice 5 alpha UX

- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`.
- Create or modify: recording-ingest application modules selected by the Slice 3 child plan.
- Modify: `packages/batch-frontend/src/utils/api.ts`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`.
- Modify: Step 2 view components and tests.
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.ts`.
- Add focused backend integration, frontend API, component, and sandbox-state tests.
- Update package READMEs, backend/frontend alignment, production environment checklist, and active transcription reference docs.

---

### Task 1: Freeze the source and decision contracts

**Files:**

- Create: `docs/superpowers/specs/2026-07-18-audio-ingest-expansion-design.md`
- Create: `docs/superpowers/plans/2026-07-18-audio-ingest-expansion.md`
- Reference: `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`
- Reference: `docs/plans/stt-multi-provider-refactor/README.md`
- Reference: issue `#145`

**Interfaces:**

- Produces: approved source-agnostic ingest architecture.
- Produces: slice gates, human checkpoints, and repository file boundaries.
- Consumes: existing explicit-provider and canonical-transcript invariants.

- [ ] **Step 1: Review the design for prohibited placeholders and accidental scope**

  Search both documents for `TBD`, `TODO`, `somehow`, `appropriate`, and `as needed`.

  Expected: no unresolved implementation placeholder.

- [ ] **Step 2: Confirm the design does not change active runtime behavior**

  Run:

  ```powershell
  git diff --name-only main...HEAD
  ```

  Expected at the planning PR stage: only the two new documentation files and generated documentation indexes, if required by repository tooling.

- [ ] **Step 3: Run documentation validation**

  ```powershell
  corepack pnpm docs:generate:indexes
  corepack pnpm format:write
  corepack pnpm format
  corepack pnpm run lint:repo-hygiene
  corepack pnpm docs:check
  ```

  Expected: all commands pass; generated indexes contain the new design/plan where repository rules include those directories.

- [ ] **Step 4: Commit the planning baseline**

  ```powershell
  git add docs/superpowers/specs/2026-07-18-audio-ingest-expansion-design.md docs/superpowers/plans/2026-07-18-audio-ingest-expansion.md docs/generated
  git commit -m "docs(plan): define source-agnostic audio ingest program"
  ```

**Expected outcome:** one docs-only `release:none` PR that future agents can execute without reconstructing the product reasoning from chat history.

---

### Task 2: Build the private corpus manifest and synthetic regression pack

**Files:**

- Create: `scripts/audio-benchmark/README.md`
- Create: `scripts/audio-benchmark/schema.ts`
- Create: `scripts/audio-benchmark/manifest.ts`
- Create: `scripts/audio-benchmark/fixtures/generate-synthetic-audio.ts`
- Create: `scripts/audio-benchmark/tests/schema.test.ts`
- Create: `scripts/audio-benchmark/tests/manifest.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**

- Produces:

  ```ts
  export type BenchmarkTopology =
    | 'trusted_split_channels'
    | 'separate_participant_tracks'
    | 'mic_plus_far_end_reference'
    | 'mixed_recording';

  export interface BenchmarkCase {
    id: string;
    topology: BenchmarkTopology;
    sourceFiles: Array<{
      role: 'combined' | 'tutor_mic' | 'far_end' | 'participant';
      relativePath: string;
      sha256: string;
    }>;
    platform: 'obs' | 'telemost' | 'teams' | 'zoom' | 'meet' | 'livedigital' | 'other';
    headphones: boolean | null;
    languages: string[];
    consent: {
      basis: 'synthetic' | 'reenacted' | 'private_research_consent';
      deleteAfter: string | null;
    };
    referenceSpansPath: string | null;
    tags: string[];
  }

  export interface BenchmarkManifest {
    manifestVersion: '1';
    corpusId: string;
    cases: BenchmarkCase[];
  }
  ```

- Produces: `loadBenchmarkManifest(path, root): Promise<BenchmarkManifest>`.
- Produces: `verifyBenchmarkSources(manifest, root): Promise<VerificationResult>`.
- Consumes: maintainer-controlled `ESL_AUDIO_BENCHMARK_ROOT`.

- [ ] **Step 1: Write failing schema tests**

  Add tests that accept a valid synthetic case and reject absolute paths, `..` path traversal, missing SHA-256, student names embedded in case IDs, real-media cases without a consent basis, duplicate case IDs, and duplicate role/path entries.

  The successful assertion must include:

  ```ts
  expect(parseBenchmarkManifest(validManifest)).toMatchObject({
    manifestVersion: '1',
    corpusId: 'audio-ingest-alpha-1',
    cases: [{ id: 'synthetic-split-001', topology: 'trusted_split_channels' }],
  });
  ```

- [ ] **Step 2: Run tests and verify failure**

  ```powershell
  corepack pnpm exec vitest run scripts/audio-benchmark/tests/schema.test.ts scripts/audio-benchmark/tests/manifest.test.ts
  ```

  Expected: FAIL because the benchmark schema and manifest loader do not exist.

- [ ] **Step 3: Implement the manifest schema and safe path resolution**

  Use Zod for the manifest schema. Resolve every source path with `path.resolve(root, relativePath)`, then reject it unless it is equal to `root` or starts with `${root}${path.sep}`.

  Hash files through a stream:

  ```ts
  export async function sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(filePath), hash);
    return hash.digest('hex');
  }
  ```

  `verifyBenchmarkSources()` returns per-file `ok`, `missing`, or `hash_mismatch` records and never prints transcript contents.

- [ ] **Step 4: Add synthetic fixture generation**

  Generate short WAV fixtures with deterministic PCM samples: silence, one sine tone per synthetic speaker, split stereo, mixed mono, and delayed far-end leakage into a microphone track.

  The fixture generator must not call a network service and must produce the same SHA-256 values for the same generator version.

- [ ] **Step 5: Add operator scripts and ignore rules**

  Add:

  ```json
  {
    "audio:benchmark:fixtures": "tsx scripts/audio-benchmark/fixtures/generate-synthetic-audio.ts",
    "audio:benchmark:verify": "tsx scripts/audio-benchmark/manifest.ts verify"
  }
  ```

  Ignore:

  ```gitignore
  .local/audio-benchmark/
  reports/audio-benchmark/private/
  ```

- [ ] **Step 6: Verify and commit**

  ```powershell
  corepack pnpm audio:benchmark:fixtures
  $env:ESL_AUDIO_BENCHMARK_ROOT = ".local/audio-benchmark"
  corepack pnpm audio:benchmark:verify
  corepack pnpm exec vitest run scripts/audio-benchmark/tests/schema.test.ts scripts/audio-benchmark/tests/manifest.test.ts
  git add package.json .gitignore scripts/audio-benchmark
  git commit -m "test(audio): add private corpus manifest harness"
  ```

  Expected: synthetic corpus verifies; no generated audio is staged.

**Human checkpoint:** maintainer adds consent-safe real cases outside Git and reviews the manifest metadata.

**Blocker cleared:** Slice 0 closes only after the frozen corpus includes the four required topologies or explicitly records why one is unavailable.

**Expected outcome:** a reproducible corpus identity and safe local workflow without exposing lesson content.

---

### Task 3: Create deterministic media probing

**Files:**

- Create: `packages/media-ingest-core/package.json`
- Create: `packages/media-ingest-core/tsconfig.json`
- Create: `packages/media-ingest-core/src/types.ts`
- Create: `packages/media-ingest-core/src/process-runner.ts`
- Create: `packages/media-ingest-core/src/probe.ts`
- Create: `packages/media-ingest-core/src/index.ts`
- Create: `packages/media-ingest-core/tests/process-runner.test.ts`
- Create: `packages/media-ingest-core/tests/probe.test.ts`

**Interfaces:**

- Produces: `MediaProbe`, `MediaStreamProbe`, and `probeMedia(input): Promise<MediaProbe>`.
- Produces:

  ```ts
  export interface MediaProcessRunner {
    run(
      command: string,
      args: readonly string[],
      options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
      },
    ): Promise<{ stdout: string; stderr: string }>;
  }
  ```

- Consumes: local `ffprobe` executable on `PATH`.

- [ ] **Step 1: Write failing process-runner tests**

  Cover successful stdout/stderr capture, missing executable, non-zero exit, timeout termination, abort signal, and argument-array execution without shell interpolation.

- [ ] **Step 2: Write failing probe tests**

  Use generated synthetic WAV/Opus/WebM fixtures and assert normalized facts, not raw JSON shape:

  ```ts
  expect(await probeMedia({ filePath: splitStereoPath })).toMatchObject({
    durationMs: expect.any(Number),
    streams: [
      expect.objectContaining({
        kind: 'audio',
        channels: 2,
        sampleRateHz: 48000,
      }),
    ],
  });
  ```

  Add fixtures for no-audio video and corrupt input. Expect typed errors:

  ```ts
  type MediaProbeErrorCode =
    | 'probe_unavailable'
    | 'probe_timeout'
    | 'probe_failed'
    | 'no_audio_stream'
    | 'invalid_probe_output';
  ```

- [ ] **Step 3: Run tests and verify failure**

  ```powershell
  corepack pnpm --filter @esl-pipeline/media-ingest-core test
  ```

  Expected: FAIL because the package and functions do not exist.

- [ ] **Step 4: Implement the runner and ffprobe parser**

  Invoke:

  ```text
  ffprobe -v error -show_format -show_streams -of json <input>
  ```

  Parse the external JSON through a Zod boundary, convert seconds to rounded milliseconds, parse numeric strings safely, and sort streams by index.

  Do not infer platform, topology, or speaker roles in this package.

- [ ] **Step 5: Add executable capability reporting**

  Export:

  ```ts
  export async function getMediaToolCapabilities(): Promise<{
    ffprobe: { available: boolean; version: string | null };
    ffmpeg: { available: boolean; version: string | null };
  }>;
  ```

  Version calls use `-version`, a five-second timeout, and return `available: false` rather than throwing for missing tools.

- [ ] **Step 6: Run tests and commit**

  ```powershell
  corepack pnpm --filter @esl-pipeline/media-ingest-core test
  corepack pnpm --filter @esl-pipeline/media-ingest-core typecheck
  git add packages/media-ingest-core
  git commit -m "feat(audio): add deterministic media probing"
  ```

**Expected outcome:** application and benchmark code can inspect realistic media through one tested boundary.

---

### Task 4: Add normalization with immutable outputs

**Files:**

- Modify: `packages/media-ingest-core/src/types.ts`
- Create: `packages/media-ingest-core/src/normalize.ts`
- Modify: `packages/media-ingest-core/src/index.ts`
- Create: `packages/media-ingest-core/tests/normalize.test.ts`
- Modify: `scripts/audio-benchmark/schema.ts`
- Modify: `scripts/audio-benchmark/run.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface NormalizeMediaRequest {
    inputPath: string;
    outputPath: string;
    sampleRateHz: 16000 | 48000;
    channelMode: 'preserve' | 'mono' | 'stereo';
    preparationVersion: string;
    signal?: AbortSignal;
  }

  export interface NormalizedMediaResult {
    outputPath: string;
    sha256: string;
    durationMs: number;
    sampleRateHz: 16000 | 48000;
    channels: 1 | 2;
    container: 'wav';
    codec: 'pcm_s16le';
    preparationVersion: string;
  }

  export async function normalizeMedia(
    request: NormalizeMediaRequest,
    dependencies?: { runner?: MediaProcessRunner },
  ): Promise<NormalizedMediaResult>;
  ```

- Consumes: `probeMedia()` from Task 3.

- [ ] **Step 1: Write failing normalization tests**

  Cover WebM video to mono WAV, M4A/MP3/Opus to WAV when fixtures are available, preserve trusted stereo, deterministic output hash, pre-existing matching output reuse, temporary-file cleanup after failure, timeout and abort, duration drift under 20 ms for short fixtures, and no overwrite of an unrelated existing output.

- [ ] **Step 2: Run tests and verify failure**

  ```powershell
  corepack pnpm --filter @esl-pipeline/media-ingest-core test -- normalize.test.ts
  ```

  Expected: FAIL because `normalizeMedia()` does not exist.

- [ ] **Step 3: Implement atomic normalization**

  Write to `${outputPath}.partial-<uuid>`, then probe the result and atomically rename only after validation.

  Use the command shape:

  ```text
  ffmpeg -nostdin -hide_banner -loglevel error -i <input>
    -map 0:a:0 -vn -c:a pcm_s16le -ar <sampleRate>
    [-ac 1|-ac 2] <temporaryOutput>
  ```

  Reject outputs with no audio, zero duration, unexpected codec, unexpected channel count, or duration drift beyond the tested tolerance.

- [ ] **Step 4: Add benchmark normalization records**

  Extend benchmark results with:

  ```ts
  export interface PreparationRecord {
    caseId: string;
    preparationVersion: string;
    inputSha256: string;
    outputSha256: string;
    outputRelativePath: string;
    durationMs: number;
    sampleRateHz: number;
    channels: number;
    elapsedMs: number;
  }
  ```

  Reports reference hashes and metrics only, never private paths.

- [ ] **Step 5: Verify realistic samples**

  Run against every frozen corpus case:

  ```powershell
  $env:ESL_AUDIO_BENCHMARK_ROOT = "<private corpus path>"
  corepack pnpm audio:benchmark:prepare -- --manifest "<manifest path>"
  ```

  Expected: supported cases produce validated normalized WAV files under the private benchmark root. Unsupported or corrupt cases produce typed failure records.

- [ ] **Step 6: Commit**

  ```powershell
  git add packages/media-ingest-core scripts/audio-benchmark
  git commit -m "feat(audio): normalize lesson media deterministically"
  ```

**Human checkpoint:** listen to a short sample from every source category to confirm normalization has not changed speed, pitch, channel role, or intelligibility.

**Expected outcome:** common platform files are converted into a stable working format without entering the production upload path yet.

---

### Task 5: Capture the Inworld benchmark contract and add provider-neutral runs

**Files:**

- Create: `docs/research/audio-ingest/2026-<evaluation-date>-provider-contracts.md`
- Create: `scripts/audio-benchmark/providers/types.ts`
- Create: `scripts/audio-benchmark/providers/deepgram.ts`
- Create after contract review: `scripts/audio-benchmark/providers/inworld.ts`
- Create: `scripts/audio-benchmark/run.ts`
- Create: `scripts/audio-benchmark/tests/provider-runner.test.ts`
- Create: `scripts/audio-benchmark/tests/run.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces:

  ```ts
  export interface BenchmarkProvider {
    id: 'deepgram' | 'inworld';
    model: string;
    transcribe(input: {
      filePath: string;
      topology: BenchmarkTopology;
      languageHints: string[];
      outputDirectory: string;
    }): Promise<BenchmarkProviderResult>;
  }

  export interface BenchmarkProviderResult {
    provider: 'deepgram' | 'inworld';
    model: string;
    requestId: string | null;
    textPath: string;
    rawResponsePath: string;
    segmentsPath: string | null;
    billedUnits: Record<string, number | string>;
    elapsedMs: number;
    retries: number;
    success: boolean;
    errorCategory: string | null;
  }
  ```

- Consumes: immutable normalized artifacts from Task 4.
- Does not register Inworld in `stt-provider-registry.ts`.

- [ ] **Step 1: Record dated official contracts**

  The research document records for each provider: official model identifier, endpoint and request mode, supported file/container assumptions, language and code-switch options, channel and diarization behavior, response segment/speaker fields, synchronous/asynchronous behavior, retryable status guidance, published pricing unit, billing granularity, retention/deletion controls, source URLs, and access date.

  Do not proceed with `providers/inworld.ts` until the maintainer reviews this contract snapshot.

- [ ] **Step 2: Write failing provider-runner tests**

  Use fake providers and assert the exact same prepared file hash is supplied to each provider, raw response and normalized text paths stay under the private output root, failures are recorded rather than aborting unrelated cases, provider runs can resume without repeating a successful identical fingerprint, and fingerprints include provider, model, options, prepared SHA, and runner version.

- [ ] **Step 3: Implement the Deepgram benchmark adapter**

  Reuse active configuration semantics but isolate output from production transcript storage. Preserve raw response, normalized segments, request ID, retries, elapsed time, and provider-reported billing metadata where available.

- [ ] **Step 4: Implement the reviewed Inworld benchmark adapter**

  Implement the exact contract captured in Step 1. Keep it benchmark-only. Map its output into the interface above without pretending unsupported speaker data exists.

  Credentials come from an Inworld-specific environment variable named in the research contract document. Secrets must never be written to reports or raw response metadata.

- [ ] **Step 5: Add selected-case orchestration**

  Add:

  ```json
  {
    "audio:benchmark:run": "tsx scripts/audio-benchmark/run.ts",
    "audio:benchmark:report": "tsx scripts/audio-benchmark/report.ts"
  }
  ```

  CLI selectors include `--case`, `--tag`, `--provider`, `--topology`, and `--resume`.

- [ ] **Step 6: Run synthetic and real smoke cases**

  ```powershell
  corepack pnpm audio:benchmark:run -- --tag synthetic --provider deepgram --provider inworld
  corepack pnpm audio:benchmark:run -- --case "<approved real smoke case>" --provider deepgram --provider inworld
  ```

  Expected: both providers receive the same prepared hash; private raw outputs are retained locally; the command prints only case IDs and aggregate status.

- [ ] **Step 7: Commit**

  ```powershell
  git add docs/research/audio-ingest scripts/audio-benchmark package.json
  git commit -m "test(stt): add reproducible provider benchmark runs"
  ```

**Blocker cleared:** both provider contracts and test outputs can be compared without changing production registration.

**Expected outcome:** issue #145 has a reproducible execution path rather than an informal side-by-side transcript comparison.

---

### Task 6: Add scoring, cost normalization, and downstream usefulness reports

**Files:**

- Create: `scripts/audio-benchmark/reference.ts`
- Create: `scripts/audio-benchmark/score.ts`
- Create: `scripts/audio-benchmark/report.ts`
- Create: `scripts/audio-benchmark/tests/reference.test.ts`
- Create: `scripts/audio-benchmark/tests/score.test.ts`
- Create: `scripts/audio-benchmark/tests/report.test.ts`
- Create: `docs/research/audio-ingest/benchmark-rubric.md`

**Interfaces:**

- Produces machine-computed edit metrics and human-entered pedagogical scores.
- Produces an anonymized report containing:

  ```ts
  export interface CaseScore {
    caseId: string;
    provider: 'deepgram' | 'inworld';
    model: string;
    topology: BenchmarkTopology;
    wordErrorRate: number | null;
    deletionRate: number | null;
    insertionRate: number | null;
    substitutionRate: number | null;
    severePedagogicalErrors: number;
    speakerRoleErrors: number;
    manualRepairMinutes: number | null;
    downstreamUsefulness: 1 | 2 | 3 | 4 | 5 | null;
    elapsedMs: number;
    successfulCostUsd: number | null;
  }
  ```

- [ ] **Step 1: Write the rubric before scoring**

  Define severe pedagogical errors as meaning-changing loss or corruption involving learner errors being silently corrected, teacher correction/contrast lost, negation or modality reversed, speaker role swapped for a teaching point, task instruction materially changed, language switch erased, or name/number corruption that changes the exercise.

  Human score files contain case IDs and numeric/category labels, not copied transcript passages.

- [ ] **Step 2: Write failing metric and report tests**

  Cover token normalization, empty references, insertion/deletion/substitution counts, missing cost data, failed provider runs, aggregate per-topology tables, and redaction of absolute paths.

- [ ] **Step 3: Implement deterministic mechanical scoring**

  Keep the tokenizer and normalization versioned. Report both raw and normalized counts. Do not normalize away learner grammar errors, negation, or code-switches.

- [ ] **Step 4: Implement cost normalization**

  Store dated price rules separately from run results:

  ```ts
  export interface ProviderPriceRule {
    provider: 'deepgram' | 'inworld';
    model: string;
    effectiveDate: string;
    unit: 'audio_minute' | 'audio_hour' | 'request_unit';
    usdPerUnit: number;
    roundingSeconds: number | null;
    sourceNote: string;
  }
  ```

  Report list-price cost per successful audio hour, actual billed cost when available, cost including failed/retried work, projected monthly costs at 25, 100, 500, and 2,000 lesson hours, and promotional credits in a separate non-decision column.

- [ ] **Step 5: Add downstream usefulness sampling**

  Select a bounded, frozen subset. Run the same downstream extraction/generation configuration from each provider transcript. Record only evaluation metrics and artifact IDs in the benchmark report; keep generated private content outside Git.

- [ ] **Step 6: Generate and review the first report**

  ```powershell
  corepack pnpm audio:benchmark:report -- --manifest "<manifest path>" --output "reports/audio-benchmark/private/report.html"
  ```

  Expected: report contains per-case and per-topology comparisons, cost projections, severe-error counts, and missing-evidence warnings.

- [ ] **Step 7: Commit code and the non-sensitive rubric only**

  ```powershell
  git add scripts/audio-benchmark docs/research/audio-ingest/benchmark-rubric.md
  git commit -m "test(stt): score quality and cost per audio topology"
  ```

**Human checkpoint:** maintainer performs blinded pedagogical review and records correction minutes.

**Expected outcome:** a production provider decision can be defended using quality per dollar and downstream utility, not vendor demos.

---

### Task 7: Define topology classification and preparation provenance

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Create: `packages/batch-backend/src/application/media-ingest/topology.ts`
- Create: `packages/batch-backend/src/application/media-ingest/prepare.ts`
- Create: `packages/batch-backend/tests/application.media-ingest.topology.test.ts`
- Create: `packages/batch-backend/tests/application.media-ingest.prepare.test.ts`
- Create: a child migration plan after Slice 1 establishes required persisted fields.

**Interfaces:**

- Produces the `AudioInputTopology`, `TopologyDecision`, `NormalizedMediaArtifact`, and `PreparedSttInput` contracts from the design document.
- Consumes: `MediaProbe` and normalized results from `@esl-pipeline/media-ingest-core`.

- [ ] **Step 1: Write classification tests**

  Cover explicit current split-channel mode, explicit mic/far-end file roles, explicit participant-track collection, single ordinary recording, two files with ambiguous roles, filename-only hints, mismatched durations, and no-audio source.

  Required behavior:

  ```ts
  expect(classifyTopology(explicitMicAndFarEnd)).toEqual({
    topology: 'mic_plus_far_end_reference',
    confidence: 'explicit',
    evidence: ['upload_roles:tutor_mic,far_end'],
    requiresTutorConfirmation: false,
  });
  ```

  Ambiguous multi-file input must require tutor confirmation.

- [ ] **Step 2: Run tests and verify failure**

  ```powershell
  corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.media-ingest.topology.test.ts tests/application.media-ingest.prepare.test.ts
  ```

  Expected: FAIL because the contracts and modules do not exist.

- [ ] **Step 3: Implement pure classification**

  `classifyTopology()` accepts probe facts plus explicit upload metadata. It does not read storage, call FFmpeg, call STT, or inspect transcript text.

- [ ] **Step 4: Implement an internal preparation router**

  Initial supported routes:

  - `trusted_split_channels` → normalize with channel preservation;
  - `mixed_recording` → normalize to provider-compatible mono/stereo and request diarization where supported;
  - `separate_participant_tracks` → return `not_implemented` until a child plan defines alignment/merge;
  - `mic_plus_far_end_reference` → return `not_implemented` until Slice 4 passes;
  - `manual_transcript` → not passed to this router.

  The router returns typed bounded outcomes rather than silently choosing another topology.

- [ ] **Step 5: Draft the persistence child plan**

  Use real Slice 1 outputs to decide whether to add a `recording_media_artifacts` table, ingest-attempt rows, JSON provenance on recordings, or a smaller additive structure.

  The child plan must preserve original, normalized, and prepared artifact lineage and include cleanup/retention semantics.

- [ ] **Step 6: Verify and commit**

  ```powershell
  corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.media-ingest.topology.test.ts tests/application.media-ingest.prepare.test.ts
  corepack pnpm --filter @esl-pipeline/batch-backend typecheck
  git add packages/contracts/src/index.ts packages/batch-backend/src/application/media-ingest packages/batch-backend/tests/application.media-ingest.*
  git commit -m "feat(audio): classify ingest topology explicitly"
  ```

**Expected outcome:** source interpretation becomes an explicit tested contract before production upload behavior changes.

---

### Task 8: Run the offline AEC feasibility gate

**Files:**

- Create: `scripts/audio-benchmark/aec/types.ts`
- Create: `scripts/audio-benchmark/aec/align.ts`
- Create: `scripts/audio-benchmark/aec/run-candidate.ts`
- Create: `scripts/audio-benchmark/aec/metrics.ts`
- Create: `scripts/audio-benchmark/tests/aec.align.test.ts`
- Create: `scripts/audio-benchmark/tests/aec.metrics.test.ts`
- Create: `docs/research/audio-ingest/aec-evaluation.md`

**Interfaces:**

- Produces:

  ```ts
  export interface AecCase {
    caseId: string;
    micPath: string;
    farEndPath: string;
    referenceTutorSpansPath: string | null;
  }

  export interface AecRunResult {
    candidate: string;
    candidateVersion: string;
    initialDelayMs: number;
    driftPpm: number | null;
    outputPath: string;
    outputSha256: string;
    farEndLeakageReductionDb: number | null;
    tutorSpeechRetentionScore: number | null;
    elapsedMs: number;
    warnings: string[];
  }
  ```

- [ ] **Step 1: Generate deterministic delayed-echo fixtures**

  Create synthetic mic audio as `nearEnd + gain * delayedFarEnd`, including a double-talk region. Assert alignment finds the known delay within one analysis frame.

- [ ] **Step 2: Implement delay and drift estimation**

  Use windowed normalized cross-correlation on downsampled mono analysis audio. Estimate initial delay and compare offsets across the recording to derive drift parts per million.

  Keep this analysis separate from any chosen AEC implementation.

- [ ] **Step 3: Select bounded AEC candidates**

  Record candidate name, exact version, license, invocation/build requirements, supported sample rates, delay expectations, and double-talk behavior.

  Compare at least a WebRTC AEC3-based path if a maintainable binding or executable is available, plus SpeexDSP or another bounded offline reference implementation. If only one candidate can be integrated safely, document why the other was rejected before running the gate.

- [ ] **Step 4: Add objective metrics**

  Measure correlation/energy of far-end-only regions before and after, tutor reference-span preservation, clipping, duration drift, processing time per audio hour, and failure rate.

  Objective metrics do not replace listening review.

- [ ] **Step 5: Run STT on original and cleaned tracks**

  Compare duplicated student phrases on the tutor track, tutor deletions during double-talk, severe pedagogical errors, and resulting provider cost when multiple tracks require separate requests.

- [ ] **Step 6: Apply the go/no-go gate**

  AEC passes only when all are true on the representative subset:

  - far-end leakage is materially reduced;
  - no systematic loss of tutor corrections or short interjections;
  - double-talk remains usable;
  - cleaned-track STT is better than or equal to mixed-audio diarization for pedagogical usefulness;
  - processing cost and runtime are operationally acceptable;
  - candidate packaging has a viable production path.

  Otherwise retain the experiment as evidence and do not add AEC to production ingest.

- [ ] **Step 7: Commit non-sensitive harness and decision record**

  ```powershell
  git add scripts/audio-benchmark/aec scripts/audio-benchmark/tests/aec.* docs/research/audio-ingest/aec-evaluation.md
  git commit -m "test(audio): evaluate offline echo cancellation"
  ```

**Human checkpoint:** blind-listen to tutor-only, student-only, and double-talk excerpts from every real AEC case.

**Expected outcome:** a defensible answer to whether separate mic/system capture can remove the headphone requirement.

---

### Task 9: Ship universal alpha upload for proven routes

**Prerequisite:** Tasks 2–7 pass; Task 8 is optional unless mic-plus-reference is included.

**Files:**

- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`
- Modify/create: media-ingest persistence and preparation modules from the Slice 3 child plan
- Modify: `packages/batch-backend/src/application/process-transcribe-job.ts`
- Modify: `packages/batch-frontend/src/utils/api.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`
- Modify: Step 2 UI component(s)
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.ts`
- Add: focused backend/frontend tests and sandbox scenarios
- Modify: active package/reference/operations documentation

**Interfaces:**

- Produces an upload request that explicitly declares source mode:

  ```ts
  export type RecordingUploadMode =
    | 'auto_single_file'
    | 'trusted_split_channels'
    | 'mixed_recording';

  export interface RecordingUploadResponse {
    // existing fields remain
    ingest?: {
      sourceMode: RecordingUploadMode;
      detectedContainer: string | null;
      topology: AudioInputTopology;
      topologyConfidence: 'explicit' | 'strong' | 'weak';
      requiresTutorConfirmation: boolean;
      preparationState: 'queued' | 'ready' | 'failed';
      preparationErrorCode: string | null;
    };
  }
  ```

- Does not add multi-file or mic/far-end production upload unless their separate gates pass.

- [ ] **Step 1: Write backend route and worker tests**

  Cover current Opus upload compatibility, supported common media inputs proven by Slice 1, no-audio rejection, original storage before normalization, idempotence by source hash plus preparation version, derived/source artifact separation, provider submission of the prepared artifact, cache fingerprints including preparation version and prepared hash, and bounded retries that preserve the source.

- [ ] **Step 2: Implement backend feature gating**

  Add configuration that defaults the new universal path off in production and on only in sandbox/test or explicitly configured alpha workspaces.

  Keep the existing direct path for current trusted Opus recordings until production evidence supports full cutover.

- [ ] **Step 3: Write frontend tests**

  Cover common media picker copy, detected source summary, “video will be converted automatically” status, preparation progress separate from upload progress, topology confirmation when needed, unsupported file message, retry preparation, resume after refresh, current Opus path, and manual transcript path.

- [ ] **Step 4: Implement Step 2 UX**

  The normal CTA is **Choose lesson recording**. Do not expose codecs, sample rates, FFmpeg, provider raw options, or topology vocabulary unless Support details is opened.

  Show filename, duration, source/platform hint when confident, whether speaker separation is available, upload/preparation/transcription state, and any required tutor confirmation.

- [ ] **Step 5: Add sandbox scenarios**

  Include Telemost WebM accepted, mixed M4A accepted, current split Opus accepted, no-audio video rejected, preparation failed and retry succeeds, and ambiguous two-file input not yet accepted.

- [ ] **Step 6: Run focused and broad validation**

  ```powershell
  corepack pnpm --filter @esl-pipeline/media-ingest-core test
  corepack pnpm --filter @esl-pipeline/batch-backend test
  corepack pnpm --filter @esl-pipeline/batch-frontend test
  corepack pnpm --silent run check:fast:agent
  corepack pnpm docs:generate:indexes
  corepack pnpm docs:check
  ```

  Expected: PASS.

- [ ] **Step 7: Conduct supervised alpha trials**

  Ask each available tutor to upload the untouched recording they normally receive from their platform. Record time from lesson end to upload start, upload/preparation success, founder intervention, transcript correction minutes, provider/topology, whether headphones were used, and whether the tutor would repeat the workflow.

- [ ] **Step 8: Apply rollout gate**

  Keep the route enabled only when at least 80% of representative files complete without founder intervention, no source is lost, preparation failures are actionable, current Opus behavior is preserved, transcript usefulness is not materially worse than the control for the supported topology, and storage/processing costs are measured.

**Expected outcome:** the first credible non-OBS workflow reaches alpha tutors without platform lock-in.

---

### Task 10: Record the provider and capture-product decisions

**Files:**

- Update: issue `#145`
- Create: `docs/research/audio-ingest/provider-decision.md`
- Create: `docs/research/audio-ingest/capture-automation-decision.md`
- Create a separate bounded implementation plan for any selected provider adapter/cutover.
- Create a separate design and implementation plan for any selected capture helper or platform import.

**Interfaces:**

- Consumes: benchmark report, alpha trials, provider invoices/usage, AEC gate, and tutor friction evidence.
- Produces one provider recommendation and one capture-product recommendation.

- [ ] **Step 1: Decide the production STT direction**

  Select exactly one:

  - switch default to Inworld;
  - retain Deepgram;
  - retain explicit multi-provider availability for a measured routing/fallback reason.

  The decision document includes per-topology quality, severe errors, correction time, successful cost per hour, latency, reliability, privacy/retention, and maintenance cost.

- [ ] **Step 2: Open a provider implementation plan only when required**

  If Inworld wins, plan a production `@esl-pipeline/stt-provider-inworld` adapter, configuration validation, cache fingerprint, contract changes, frontend metadata, tests, rollout, and rollback.

  Do not mix the production adapter into the benchmark PR.

- [ ] **Step 3: Decide whether capture automation is still necessary**

  Select exactly one initial direction:

  - no helper; universal upload is sufficient;
  - lightweight folder watcher/import helper;
  - native Windows mic + application-audio recorder;
  - browser capture for a proven web-only audience;
  - platform-specific import;
  - defer because residual friction does not justify maintenance.

  Base the choice on actual tutor platforms, speakers/headphones, repeated upload friction, and willingness to install software.

- [ ] **Step 4: Close or split the program**

  Archive completed child plans. Convert surviving unknowns into narrow issues rather than keeping a permanent mega-roadmap.

**Expected outcome:** the program ends with explicit commercial and product choices, not an indefinitely expanding audio laboratory.

---

## Program-Level Verification

Before declaring the program complete:

```powershell
corepack pnpm format
corepack pnpm run lint:repo-hygiene
corepack pnpm --silent run check:fast:agent
corepack pnpm check:pre-pr
corepack pnpm docs:generate:indexes
corepack pnpm docs:check
corepack pnpm --filter @esl-pipeline/media-ingest-core test
corepack pnpm --filter @esl-pipeline/stt-core test
corepack pnpm --filter @esl-pipeline/stt-provider-deepgram test
corepack pnpm --filter @esl-pipeline/batch-backend test
corepack pnpm --filter @esl-pipeline/batch-frontend test
```

Operational evidence must also include:

- media-tool availability in the production backend image;
- a realistic maximum-duration sample;
- storage growth estimate for originals and derived artifacts;
- retry and cleanup behavior;
- provider cost without promotional credits;
- one current OBS regression;
- one natural platform recording;
- one supervised alpha tutor run;
- explicit retention behavior.

## Rollback Strategy

- Keep new production ingest routes feature-gated.
- Preserve current direct Opus processing until universal ingest proves stable.
- A preparation failure does not mutate or delete the original recording.
- Provider default rollback remains configuration-based.
- Schema additions are additive; rollback disables new reads/writes rather than dropping provenance.
- AEC remains outside production unless its gate passes.
- Removing a source-format UI option does not make existing source artifacts unreadable.

## Definition of Done

The program is done when:

- a source-agnostic ingest architecture is represented in active reference docs;
- at least one normal platform recording completes the full assignment workflow;
- current OBS and manual transcript paths remain compatible;
- supported file types and limits are evidence-backed;
- topology and preparation provenance are durable;
- provider quality and cost are reproducibly measured;
- the Deepgram/Inworld decision is recorded;
- the AEC question has a documented result;
- capture automation is either justified with a new bounded plan or explicitly deferred;
- private benchmark material remains outside Git and CI;
- alpha tutors can understand and recover from ingest failures without founder-only knowledge.
