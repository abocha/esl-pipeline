# Ordinary Lesson Recording Ingest Readiness

## Meta

- Audience: maintainers implementing or reviewing ordinary lesson-recording ingest.
- Authority Level: approved Goal Contract execution plan.
- Last Verified Against: 2026-09-09 current `codex/audio-topology` Slice 7 closeout tree and persisted Slice 1–6 validation/review evidence.
- Owner: founder-maintainer + speech-runtime maintainers.
- Review Cadence: before implementation and after any material recording, tenant, retry, or retention contract change.
- Status: `active`.
- Exit Trigger: archive after implementation is merged, production rollout evidence satisfies the Goal Contract, and active runtime/operations docs own the shipped behavior.
- Current Focus: obtain hosted CI and separately authorized deployment/production rollout evidence; local implementation closeout is complete.

This is the execution strategy beneath the maintainer-approved Goal Contract. It may adapt implementation detail as evidence changes, but it must not change the locked product or architecture decisions below without maintainer approval.

## 1. Goal Contract and non-goals

### Goal Contract

A non-technical tutor can select one student and upload a supported 1:1 lesson recording of at most 100 minutes without understanding codecs, channels, topology, STT providers, or retries. ESL Pipeline safely prepares the media, automatically obtains one usable Teacher/Student transcript or terminates with an actionable failure, isolates every tutor's data, and removes lesson audio once it is no longer useful for recovery.

Completion requires evidence that:

1. A normal supported audio upload works end to end.
2. Cheap-demux video works if the feasibility boundary below remains valid in the production FFmpeg image; only its extracted audio is retained remotely and its temporary source video is removed.
3. The browser rejects a file larger than the initial 2 GiB operational upload guard before upload, while the backend independently rejects oversize, disk-capacity-constrained, corrupt, no-audio, and over-duration sources before paid STT.
4. Injected transient, ambiguous, and malformed STT failures recover automatically within the bounded retry policy.
5. Concurrent duplicate enqueue cannot create parallel STT submissions for one recording attempt.
6. Cross-tutor student resolution, recording, transcript, cache, retry, retrieval, and deletion access is denied, including legacy name-based student seams.
7. Source confirmation makes retained lesson audio unavailable and schedules physical deletion.
8. Abandoned and permanently failed audio is cleaned by policy.
9. Successful STT has no normal-user retry path.
10. Refresh/resume remains truthful throughout processing, retry, success, and terminal failure.
11. A valid same-workspace transcript-cache hit creates independent recording/transcript lineage without retaining audio or creating a transcription run, and is reported with truthful `not_retained` audio lifecycle state.

### Non-goals

Do not add or reopen:

1. Provider comparison, automatic cross-provider fallback, or subjective transcript-quality scoring.
2. Automatic topology or role inference, AEC, native recording, realtime STT, or platform-specific integrations.
3. General media transcoding, video decoding, or support for arbitrary container/codec combinations.
4. More than two speakers. The product supports exactly one tutor and one student.
5. A billing, analytics, or generalized media-processing platform.
6. ElevenLabs Zero Retention or exact-once provider billing.

## 2. Current prerequisite state

### Current campaign status

- Slices 1–7 are implemented locally in the current checkout.
- The Slice 4 exceptional-risk semantic review is `CLOSED` with no remaining findings.
- Slice 5 passed its independent Terra/high semantic review.
- Slice 6 focused validation and its narrow Sol/high exceptional-risk review are closed with no
  remaining findings. Its prior aggregate failure was isolated to an unrelated frontend test that
  subsequently passed in its owning suite; Slice 7 owns the one final aggregate gate.
- The exact production Docker runtime passed the synthetic MP4/AAC, MOV/AAC, and WebM/Opus
  stream-copy gate. Representative conferencing-platform export compatibility is still deferred to
  rollout evidence.
- Local and hosted validation status remains evidence for readiness, merge, and rollout; it is not architecture or slice-sequencing state.

### Already completed or fixed

1. ElevenLabs Scribe v2 is the production `mixed_recording` route.
2. Explicit trusted OBS split remains `trusted_split_channels` and uses Deepgram multichannel.
3. Mixed speaker-role confirmation in Source review is implemented and production-proven.
4. The provider benchmark decision is closed.
5. The atomic trusted-topology upload serialization defect has been fixed locally on `codex/audio-topology`. This plan assumes that fix is integrated and retains only regression coverage for the upload contract; it does not reimplement it.

### Remaining closeout evidence

1. Hosted PostgreSQL/Redis lanes and the fail-closed `CI gate` remain authoritative merge evidence.
2. Production read-only migration preflight, snapshot/clone rehearsal, actual presigned-S3 provider
   fetch, staged end-to-end audio/deletion smoke, and representative source-export compatibility
   require separate authorization or rollout inputs.

## 3. Locked product and architecture decisions

1. ESL Pipeline supports 1:1 lessons only. ElevenLabs mixed requests use `numSpeakers: 2`; trusted split must contain exactly the expected Teacher and Student channels.
2. Probed duration is capped at 100 minutes (`6000` seconds). The initial uploaded-source operational guard is 2 GiB (`2147483648` bytes), configured by `RECORDINGS_MAX_FILE_SIZE`; it protects transport and spool capacity rather than defining lesson quality or duration. The browser rejects a larger `File.size` before upload and the backend remains authoritative. Before accepting a spool, the backend also requires enough free space on the ingest temporary filesystem to preserve the configured `RECORDINGS_DISK_RESERVE_BYTES` (initially 10 GiB / `10737418240` bytes) after one maximum-size upload.
3. The normal route hides provider and topology concepts. Advanced trusted-split controls may remain collapsed for support/power users.
4. Preserve supported source audio byte-for-byte as the retained artifact. For supported video containers, extract one already-supported audio stream with FFmpeg stream copy, retain only that extracted audio, and remove the temporary source video; never re-encode or upload source video.
5. Reject unsupported or ambiguous media cleanly instead of adding general transcoding.
6. Use one backend-owned media ingest/probe/preparation boundary inside `batch-backend`; do not create a generalized package or plugin framework.
7. Eliminate whole-file memory scaling in both multipart ingest and ElevenLabs submission.
8. Workspace ownership is mandatory from authenticated tutor and selected-student resolution through recording, transcript, cache, retry, retrieval, confirmation, playback, and deletion. No authenticated upload path may globally derive a student from a name.
9. Resolve the complete same-workspace cache fingerprint after probe/preparation but before remote audio storage or transcription-run creation. A cache hit retains no audio and creates no run.
10. One stable transcription-run identity owns queue deduplication, execution claiming, submission-slot accounting, and final outcome.
11. The application owns one retry policy: at most three durably reserved submission slots per run that can possibly cross the paid provider boundary. Provider-library retries are disabled.
12. A genuinely ambiguous/crashed call may be charged twice during recovery; exact-once billing is not promised.
13. Retrying is non-terminal. A user sees terminal failure only after automatic recovery is exhausted or the failure is deterministic/permanent.
14. Once a usable transcript exists, normal-user retry is forbidden.
15. Retained audio remains recoverable through transcription and Source review, becomes inaccessible immediately after successful Source confirmation, and is physically deleted asynchronously. Cache-hit recordings that never retained audio remain `not_retained`. Transcripts remain durable.
16. Abandoned/permanently failed retained audio expires after seven days by default. `RECORDING_AUDIO_RECOVERY_TTL_DAYS` makes that cheap policy configurable.

## 4. Target end-to-end architecture and state machine

### Target flow

1. In the browser, reject `File.size > 2147483648` before starting the request and show the 2 GiB operational upload-limit error used for backend rejection.
2. Authenticate the tutor and resolve the tutor's primary workspace.
3. Resolve the explicitly selected student by ID within that workspace; return a non-enumerating not-found response otherwise. Authenticated upload must not use global `student=` name lookup or `deriveStudentId(studentName)`.
4. Before consuming multipart media, the frontend-owned UUID claims the workspace-scoped logical upload in `recording_upload_operations`; active duplicates resolve as processing, completed duplicates resolve their committed recording, and an expired attempt is retired before reclaim. Then admit the request only when the ingest temporary filesystem has enough point-in-time free capacity for the configured maximum upload while retaining its reserve. Stream the multipart part to a bounded temporary file while computing SHA-256 and byte count. Stop and clean up as soon as the configured byte guard is exceeded.
5. Probe the completed temporary file. Reject unsupported, corrupt, no-audio, multi-audio-stream, or over-100-minute input before storage and STT.
6. For direct supported audio, keep the spooled audio unchanged as the candidate retained artifact. For an allowed video/audio-stream pair, stream-copy the selected audio stream to a second temporary file, re-probe it, and make the extracted audio the sole candidate retained artifact. Delete the temporary source video after successful extraction. On preparation failure, delete all temporary files, store nothing remotely, and return the deterministic failure.
7. Compute the complete transcription/cache fingerprint from the candidate audio hash, probed media facts, topology, provider/request profile, language/model, and preparation version. Resolve cache only within the authenticated workspace before retained-audio storage and before transcription-run creation.
8. On a valid cache hit, transactionally create independent workspace-owned recording and transcript lineage with audio lifecycle `not_retained`; copy durable transcript content into the new lineage or omit non-required raw response, clean all temporary files, upload no audio, create no transcription run, and enqueue no transcription job.
9. On a cache miss, write one immutable attempt-specific physical upload candidate under a workspace-prefixed key. In the recording/run transaction, adopt exactly one winning candidate URI; never share a candidate or adopted audio object across recordings. Obsolete unadopted candidates remain isolated for bounded retrying cleanup.
10. In one database transaction, create the workspace-owned recording and its one active transcription run. The `recording_upload_operations` row remains the owner of the workspace-scoped logical upload identity: the client retains one UUID across ambiguous retry/resume, while intentional new or replacement uploads use a new UUID. Publish one BullMQ job whose deterministic `jobId` is the stable run ID. Queue acknowledgement is not the durable handoff: a worker-owned reconciler restores a missing, failed, or exhausted delivery for any nonterminal run.
11. The worker claims the run atomically, reserves at most one submission slot before provider work, and maintains a short durable claim lease without holding a database session across source preparation or provider I/O. Its attempt-local, single-use guarded SDK transport conditionally renews the same claim and verifies the committed slot at actual HTTP dispatch; authority loss or local deadline expiry latches cancellation before a stale continuation can dispatch. A stale claim token cannot commit a later outcome. Three slots cap only provider reservations/submissions that may cross the paid boundary, not BullMQ deliveries: reconciliation may recreate more queue executions, and an ambiguous dispatched request can conservatively consume another slot during recovery. Exact-once remote cancellation or billing is not promised.
12. Retryable outcomes, including a structurally malformed Deepgram success, transition the run to `retry_wait` and bounded recovery; BullMQ delivery count may exceed three while the recording remains user-visible as processing. Permanent outcomes or reservation exhaustion commit terminal failure first, then publish only that committed terminal projection.
13. A usable result writes the one transcript winner and transitions both run and recording to success atomically.
14. Source review maps anonymous mixed speakers to Teacher/Student when needed. Successful Source confirmation atomically marks retained audio deletion pending; a `not_retained` cache hit remains `not_retained`.
15. A separate Slice 4 worker-owned reconciler deletes only obsolete, unadopted upload-attempt candidates with bounded retries after rechecking durable adoption/reference; it never deletes recording-adopted audio.
16. Slice 6 owns lifecycle deletion of recording-adopted retained audio after Source confirmation or TTL, idempotently without deleting the recording or transcript row.

### Persistent transcription-run states

`transcription_runs.state` is the execution truth:

```text
queued -> submitting -> succeeded
                    -> retry_wait -> submitting
                    -> failed
```

Rules:

1. `queued`, `submitting`, and `retry_wait` are non-terminal.
2. `succeeded` requires a committed usable transcript.
3. `failed` means a permanent error or exhausted submission-slot budget.
4. A worker finding a stale `submitting` claim with a reserved slot and no durable result treats that slot as ambiguous and may reclaim only if another submission slot remains.
5. A database compare-and-set claim with a short durable lease, not an execution-wide advisory lock/fence or BullMQ delivery alone, determines whether work may submit.

The existing recording status remains the stable product projection:

| Run truth                  | Recording projection            | Frontend meaning                          |
| -------------------------- | ------------------------------- | ----------------------------------------- |
| upload/probe in request    | not yet persisted or `ingested` | Uploading / Checking recording            |
| `queued`                   | `queued`                        | Waiting to transcribe                     |
| `submitting`, `retry_wait` | `transcribing`                  | Transcribing / Trying again automatically |
| `succeeded`                | `transcribed`                   | Ready for Source review                   |
| `failed`                   | `failed`                        | Actionable terminal failure               |
| no run (valid cache hit)   | `transcribed`                   | Ready for Source review                   |

Do not project a retryable attempt failure as `recordings.status = 'failed'`. Clear stale error fields when a run resumes or succeeds.

## 5. Tenant ownership and data model changes

### Tenant authority

1. `workspaces.id` is the tenant boundary; authenticated user membership resolves the current workspace.
2. Resolve the selected student by ID with `students.workspace_id = authenticatedWorkspaceId` before ingest. Audit the authenticated recording/upload routes and remove or workspace-scope the legacy `student=` / `deriveStudentId(studentName)` seam. Preserve unrelated compatibility only when it still requires authenticated workspace authority and cannot perform global name resolution or bypass the selected-student contract.
3. Add `recordings.workspace_id UUID NOT NULL REFERENCES workspaces(id)` and index it.
4. A transcript inherits ownership through its required recording. User-facing transcript queries must join through `recordings.workspace_id`; do not add a second independently mutable tenant authority unless implementation evidence requires it.
5. Require `workspaceId` in every user-facing repository/application boundary for recording creation, lookup, transcript lookup/update, retry, cache lookup/reuse, assignment confirmation, playback, and deletion.
6. Keep explicitly named worker-only lookup/claim methods private to service execution. An unscoped `findById` must not remain reachable from authenticated routes.
7. Store the one retained audio artifact, when present, at a workspace-prefixed key such as `workspaces/{workspaceId}/recordings/{recordingId}/audio/...`.
8. Return the same non-enumerating 404 for absent and other-workspace resources.
9. Source confirmation must validate session, student, recording, and transcript workspace lineage in the same transaction that confirms Source.

### Cache semantics

1. Cache lookup occurs only after hashing, probe validation, and any video extraction/re-probe have established the candidate audio hash and complete preparation identity, but before remote retained-audio storage and transcription-run creation.
2. Cache lookup is workspace-scoped and includes the current complete transcription fingerprint: candidate retained-audio SHA-256, topology, provider, request/profile version, model, language, preparation version, and relevant probed channel/request behavior.
3. Cache may reuse durable transcript content only inside the same workspace.
4. A valid cache hit transactionally creates its own workspace-owned recording/transcript lineage with audio lifecycle `not_retained`. It uploads no audio, creates no `transcription_runs` row, and enqueues no job.
5. A cache-hit transcript is independently owned: copy the durable transcript content/storage artifact into the new lineage as required by the current transcript contract. Do not share an audio or raw provider-response URI; copy a raw response only if it is genuinely required, otherwise omit it.
6. A cache miss proceeds to retain exactly one audio artifact and create one run. No retained object is shared across recording rows or workspaces.
7. Before adding a unique transcript-per-recording constraint, audit and resolve any historical duplicates deterministically.

### Database additions

The current migration chain preserves the foundational `0049_recording_ingest_readiness.sql` and
`0050_recording_media_preparation_version.sql` contracts. Slice 4 adds
`0051_recording_upload_operations.sql` for workspace-scoped logical upload ownership and immutable
attempt candidates, `0052_recording_upload_candidate_cleanup_schedule.sql` for bounded candidate
cleanup retries, and `0053_recording_audio_cleanup_backfill.sql` for legacy Source-confirmed audio
unavailability. `schema.sql` and contract/version metadata track
`0053_recording_audio_cleanup_backfill` as the current migration head.

The foundational 0049/0050 schema contract includes:

1. `recordings.workspace_id` with deterministic backfill from `recordings.student_id -> students.workspace_id`, guarded unresolved-row failure, index, and final `NOT NULL`.
2. Make the existing canonical retained-audio `recordings.storage_uri` nullable so a cache-hit recording can truthfully have no remote audio object. Do not add a second source-video/prepared-audio URI: a recording has zero or one retained audio object.
3. Audio lifecycle state constrained to `not_retained`, `retained`, `pending`, `deleting`, `deleted`, or `delete_failed`, with URI/state consistency checks. `not_retained` requires `storage_uri IS NULL` because no remote object ever existed; active deletion states require a URI; successful physical deletion atomically clears the URI and records `deleted`, which means a formerly retained object was removed.
4. Explicit deletion fields such as `audio_deletion_requested_at`, `audio_deleted_at`, `audio_deletion_attempt_count`, `audio_deletion_error_code`, and `audio_deletion_next_attempt_at`. These fields never count STT work.
5. `transcription_runs` with stable UUID, recording/workspace/provider/profile identity, state, claim timing, `submission_slots_reserved`, fixed `submission_slot_limit = 3`, current/last slot number and known/ambiguous outcome where useful, stable STT error category/code, provider request ID when supplied, and queue/attempt/final latency timestamps. A cache-hit recording has no run row.
6. A partial unique index allowing at most one active run per recording.
7. A unique transcript winner per recording after the duplicate audit.
8. Corresponding `schema.sql` baseline and contract/version updates required by repository policy.

Migration 0050 preserves immutability when the 0049 checkpoint is already checksum-recorded:
nullable `recordings.media_preparation_version` is the durable owner of the canonical candidate's
captured preparation semantics. Historical rows remain `NULL` and are never relabeled from a later
worker deployment; initial and support-only retry queue payloads carry that stored value.

Do not activate broad database RLS as part of this slice. Current production enforcement remains explicit application/query scoping; dormant RLS policy text is not a substitute for it.

## 6. Media ingest, probe, and preparation contract

### Boundary and resource behavior

Implement a small backend-owned boundary with injectable process/deadline seams for tests:

1. `spoolRecordingUpload`: streams multipart input to a temporary path, hashes and counts bytes, aborts over limit, and always removes temporary files on error/cancellation.
2. `probeRecordingMedia`: invokes `ffprobe` for normalized container/stream facts and FFmpeg for bounded full audio-stream decode validation.
3. `prepareRecordingMedia`: either identifies the direct-audio spool as the sole candidate retained artifact or performs one allowlisted stream-copy extraction, re-probes it, and identifies the extracted audio as the sole candidate retained artifact.

The probe returns only deterministic facts needed by policy: normalized container, audio stream count/presence, duration, selected audio codec, channel count/layout when known, and corruption/integrity outcome. It must not infer topology or participant roles.

Use an argument-array process API, no shell interpolation. Bound subprocess output and execution time, terminate timed-out children, and clean all temporary artifacts. The integrity pass maps only the selected audio stream to a null sink with `-v error -xerror`; it does not decode video. After successful video extraction/re-probe, delete the temporary source video before cache resolution/storage continues. On any rejection or preparation failure, retain nothing remotely and delete all local temporary files.

### Initial supported media policy

Direct audio is accepted unchanged only for these probed combinations:

| User-facing family | Required probed combination          | Preparation |
| ------------------ | ------------------------------------ | ----------- |
| MP3                | MP3 container/audio                  | none        |
| WAV                | WAV with supported PCM audio         | none        |
| AAC                | ADTS AAC                             | none        |
| M4A/audio-only MP4 | ISO BMFF with AAC audio and no video | none        |
| OGG/OPUS           | Ogg with Opus audio                  | none        |
| audio-only WebM    | WebM with Opus audio and no video    | none        |

Video convenience is intentionally narrow:

| Source     | Required probe facts          | Output                                         |
| ---------- | ----------------------------- | ---------------------------------------------- |
| MP4 or MOV | exactly one AAC audio stream  | audio-only M4A via `-map 0:a:0 -vn -c:a copy`  |
| WebM       | exactly one Opus audio stream | audio-only WebM via `-map 0:a:0 -vn -c:a copy` |

Reject sources with no audio, more than one audio stream, unsupported selected codecs, unsupported container/codec pairs, corruption, or failed copy/re-probe. Do not choose among multiple audio streams heuristically.

The local read-only feasibility probe succeeded for synthetic MP4/AAC to M4A, MOV/AAC to M4A, and WebM/Opus to WebM with codec copy and no re-encoding. Before enabling video uploads, repeat the generated-fixture test inside the exact production `packages/batch-backend/Dockerfile` runtime image and assert codec, channels, and duration are preserved. Failure of that gate disables video convenience; it does not trigger transcoding work.

### Limit interaction

1. Reject multipart input beyond the configured 2 GiB initial operational guard before the upload finishes.
2. Reject `File.size > 2147483648` in the browser before creating the upload request. This is a convenience/safety guard; backend streaming enforcement is authoritative.
3. Before multipart consumption, reject admission when the temp filesystem cannot retain the configured 10 GiB reserve after one maximum-size upload. This is a point-in-time check, not a disk reservation: concurrent accepted uploads can consume the same observed capacity, so it does not promise a strict aggregate free-space floor.
4. Reject probed duration greater than 6000 seconds before storing or queueing.
5. Also reject an extracted audio artifact beyond the configured source-size guard, though stream-copy extraction should normally reduce size.
6. Do not estimate duration from bytes or trust client MIME/extension for acceptance.
7. A file must satisfy both operational byte/admission guards and the duration constraint. Backend enforcement remains authoritative even when the browser guard was bypassed.

### Expected recording-source compatibility evidence

Ordinary lesson exports are expected to originate from Zoom, Microsoft Teams, Google Meet, Yandex Telemost, LiveDigital, Jitsi, or OBS Studio, including video exports. This is an architectural compatibility direction, not certification of every current export mode. Slice 2 deliberately keeps its deterministic allowlist narrow until representative evidence supports additions.

Before general release, run a source-compatibility campaign that:

1. obtains representative exports or authoritative exact media facts for each expected source;
2. probes them with `ffprobe` in the production image and records container, selected audio codec, stream topology, and typical size;
3. adds only clearly necessary allowlist combinations and tests them; and
4. records intentional exclusions, including unusually large or high-bitrate OBS captures; and
5. obtains and probes a representative LiveDigital `.mkv` export before deciding whether its exact Matroska container, audio codec, stream count/layout, and typical size warrant allowlist support. The filename alone is not evidence of compatibility.

## 7. Retry, concurrency, and paid-call semantics

### One run, one claim, one bounded policy

1. The stable `transcription_runs.id` is the BullMQ `jobId` and logical execution identity.
2. Create/reuse the active run transactionally; concurrent enqueue requests must converge on the same active run.
3. The worker performs an atomic compare-and-set claim on run state/claim expiry before reading audio or contacting a provider.
4. Before a provider network call, atomically reserve one numbered durable submission slot by incrementing `submission_slots_reserved` and persist the run as `submitting`. The attempt-local, single-use guarded transport renews the claim and checks cancellation, the lease, and the committed slot at actual HTTP dispatch. Because a crash may occur between reservation and observable network outcome, a reserved slot is not an exact physical submission count; it is one call that could have crossed the paid boundary.
5. A run may reserve at most three submission slots. Disable ElevenLabs SDK retries and any Deepgram adapter retry layer for this path. BullMQ uses bounded backoff and delivery reconciliation; its delivery count may exceed three and is not the paid-boundary budget.
6. Generate a fresh short-lived S3 URL for each attempt. Filesystem development uses a file-backed Blob/stream supported by Node 24, never a whole-file buffer.
7. A unique transcript winner and atomic success transition prevent two completions from persisting competing transcripts.
8. Public/manual retry must reject active or successful runs. Slice 5 removes normal-user transcription retry UI; terminal failure recovery is re-upload/replace recording. Any retained support-only action must be separately authorized, workspace-scoped, and limited to terminal failed runs.

### Failure classification

Permanent failures do not reserve another submission slot. Failures classified before provider execution reserve no slot; a deterministic provider response consumes the slot already reserved for that call:

1. Invalid provider credentials/configuration.
2. Deterministic provider input rejection.
3. Unsupported/corrupt media that escaped the ingest boundary.
4. Tenant/ownership or missing retained-audio invariants.

Retryable transient failures include HTTP 408, 429, provider 5xx/unavailability, and pre-response network timeouts.

Ambiguous failures include a connection loss/timeout after a request may have reached the provider, or recovery of an expired `submitting` claim with a reserved slot and no durable result. Mark that slot outcome ambiguous; it remains consumed, may have incurred a charge, and may retry only if another of the three slots remains.

Malformed STT is objective protocol/output invalidity, not a quality judgment. Retry when the response cannot be parsed/validated, has no non-whitespace transcript or usable timed lexical segments, contains non-finite or invalid segment timing, or violates route-specific speaker structure. A malformed Deepgram success enters this bounded recovery path and never becomes a transcript winner. For `mixed_recording`, every lexical segment must have a provider speaker ID and the result must contain exactly two observed speakers. For trusted split, retain the existing exact Teacher/Student channel invariant. Do not score grammar, WER, semantic quality, confidence, or role correctness.

### Paid submission observability

Record structured, non-content telemetry per run/submission slot: run and recording IDs, workspace ID, route/provider/profile, reserved slot number, known/ambiguous slot outcome, source bytes/duration, queue wait, provider latency when known, total latency, classified error code, and provider request ID when available. Report slots that could have crossed the paid boundary, not an unverifiable exact physical-submission count. Never log audio or transcript text. SQL and structured logs are sufficient; do not build a billing subsystem or dashboard in this goal.

## 8. Audio retention and deletion lifecycle

### Lifecycle contract

Use audio lifecycle states `not_retained`, `retained`, `pending`, `deleting`, `deleted`, and `delete_failed`.

1. Direct audio retains the uploaded audio as the one STT/recovery artifact. Supported video retains only its losslessly extracted audio; the source video remains local only through successful extraction/re-probe and is then deleted. Preparation failure retains nothing remotely.
2. A valid cache hit stores no audio and starts at `not_retained`. It never transitions through deletion states, and `not_retained` must not be represented as `deleted`.
3. Retain the one audio artifact through automatic STT and Source review.
4. In the successful Source-confirmation transaction, change `retained` to `pending` and record `audio_deletion_requested_at`. Idempotent confirmation replay must preserve/restore this request. A `not_retained` recording remains `not_retained`.
5. Treat retained audio as unavailable immediately after that commit. Playback/download endpoints return a scoped gone/not-found response even while object deletion is pending. DTOs expose truthful availability/lifecycle so a cache hit does not render a broken audio control.
6. Delete only the canonical retained audio object. Preserve the recording row, transcript row/content, Source snapshot, and downstream lesson memory.
7. Missing objects count as successful idempotent deletion.
8. Never share retained audio objects across recording rows, so one recording can be cleaned without reference counting.

### Distinct cleanup authorities

- Slice 4 cleans only obsolete, unadopted physical upload-attempt candidates, with bounded retries and a durable adoption/reference recheck before deletion.
- Slice 6 owns lifecycle deletion of recording-adopted retained audio after Source confirmation or TTL. These authorities remain separate.

### Slice 6 retained-audio cleanup policy

A bounded sweeper owned by the existing transcription worker scans in small batches and claims rows with database locking safe for multiple worker replicas. It deletes:

1. `pending` Source-confirmed audio immediately.
2. Terminally failed recording audio older than `RECORDING_AUDIO_RECOVERY_TTL_DAYS` (default 7).
3. Transcribed-but-unconfirmed recording audio older than the same TTL.
4. Stale queued/transcribing audio older than the TTL only after proving there is no active run and recording a terminal stale failure.

Rows in `not_retained` are never cleanup candidates. Deletion failure increments `audio_deletion_attempt_count` and records `audio_deletion_error_code` plus `audio_deletion_next_attempt_at`; later sweeps retry with bounded backoff. These fields describe object deletion only, while all STT submission-slot accounting remains in `transcription_runs`. `RECORDING_AUDIO_CLEANUP_ENABLED` defaults off for deployment rehearsal and is enabled only after dry-run candidate counts, permissions, and synthetic deletion are verified. It must be on for Goal Contract completion.

## 9. User-visible failure and recovery semantics

The ordinary UI vocabulary is:

1. Uploading recording.
2. Checking recording.
3. Waiting to transcribe.
4. Transcribing.
5. Trying again automatically.
6. Ready for review.
7. Recording needs attention, with one actionable terminal explanation.

Provider, codec, topology, and reservation-count controls are not required knowledge. Support detail may show `reserved submission 2 of 3`, but the tutor is never asked to choose whether to retry.

Map stable backend error codes to actions:

| Error code                                | Tutor message/action                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `file_too_large`                          | Choose a source file at or below the configured 2 GiB operational upload limit.                                                   |
| `insufficient_upload_capacity`            | The server is temporarily short of upload capacity; try again later.                                                              |
| `recording_too_long`                      | Choose a lesson no longer than 100 minutes.                                                                                       |
| `no_audio`                                | This file has no usable audio; choose the lesson recording with sound.                                                            |
| `corrupt_media`                           | The recording appears damaged; play/export it again and re-upload.                                                                |
| `unsupported_media`                       | Use MP3, WAV, AAC/M4A, OGG/Opus, supported audio-only WebM, or an allowed MP4/MOV/WebM recording.                                 |
| `multiple_audio_streams`                  | Export one mixed lesson audio track or use the advanced trusted-split path.                                                       |
| `preparation_failed`                      | This video's audio could not be extracted without conversion; upload an audio export.                                             |
| `speakers_not_separated`                  | The transcript did not contain the expected two lesson speakers after automatic recovery; upload a clearer/full lesson recording. |
| `transcription_unavailable_after_retries` | Automatic transcription could not finish; upload the recording again later.                                                       |

Refresh, resume, polling, and SSE must all derive from the same run projection. While a retry is pending, they must not show terminal failure or enable manual retry. Once a usable transcript exists, remove the normal-user retry button and make the backend reject such requests.

A cache-hit recording has no run and is immediately projected as ready for Source review with `audioLifecycle = 'not_retained'` and `audioAvailable = false`; refresh/resume must not invent queue or retry state or render an audio player. The browser applies the configured 2 GiB source-file guard before upload and uses the same `file_too_large` product message, while preserving backend errors as authoritative.

## 10. Implementation slices

These are reviewable commit boundaries, not mandatory PR boundaries. Prefer one coherent implementation branch unless a slice needs independent production rollout or the combined review becomes unsafe.

### Slice 1 — Schema and tenant authority foundation

**Scope**

1. Add migration `0049_recording_ingest_readiness.sql`, baseline, types, and repositories for workspace ownership, transcription runs, transcript winner, and audio lifecycle.
2. Add a preflight query/test for unresolved recording-to-workspace backfill and duplicate transcripts.
3. Thread authenticated workspace ownership through selected-student resolution and recording/transcript/cache/retry/retrieval/playback/confirmation paths. Audit/remove or workspace-scope authenticated `student=` / `deriveStudentId(studentName)` compatibility.
4. Prefix the canonical retained-audio key by workspace, make cache transcript copies ownership-independent, and support cache-hit recording lineage with `storage_uri = NULL`, lifecycle `not_retained`, and no run.

**Dependencies:** integrated `0048_recording_audio_topology.sql` and the local atomic topology serialization fix.

**Acceptance criteria**

1. Every new recording has one workspace derived from the authenticated tutor and explicitly selected student; global name derivation cannot select a student across or outside that workspace.
2. Cross-workspace student selection, reads, updates, retries, confirmations, playback, cache reuse, and deletes return non-enumerating not-found and make no mutation.
3. Cache hits cannot cross workspaces or share audio/raw-response deletion ownership; a hit creates independent recording/transcript lineage with no audio URI and no run.
4. Lifecycle URI constraints distinguish `not_retained` from `deleted`, deletion-attempt fields cannot be confused with STT submission-slot fields, and legacy backfill is deterministic or stops with actionable row counts.

**Validation gates**

1. Repository/application/route integration tests for two workspaces and two tutors across every named surface, including adversarial duplicate student names and the legacy query seam.
2. Migration tests for clean backfill, unresolved rows, and duplicate transcript preflight.
3. `pnpm release:verify:contracts` and database baseline verification/regeneration commands required by `agents-ssot.md`.
4. Narrow Sol/high review of tenant isolation, migration integrity, and cache ownership; Terra/high review of the coherent route/repository integration batch.

### Slice 2 — Bounded streaming ingest and media policy

**Scope**

1. Add the client-side configured 2 GiB preflight guard and replace backend upload buffering with authoritative bounded temp-file spooling and streaming storage.
2. Add the small FFprobe/FFmpeg boundary, typed probe failures, allowlist, stream-copy preparation, cleanup, and limits.
3. Keep direct supported audio unchanged. For video, delete the local source after successful extraction/re-probe and make the extracted audio the only remotely retainable artifact; preparation failure stores nothing remotely.
4. Resolve the complete same-workspace cache fingerprint after preparation identity is known but before storage/run creation. A hit cleans local files and creates lineage without audio/run/enqueue; a miss stores exactly one audio artifact.
5. Keep trusted-topology controls explicit and validate trusted media against its exact channel contract after probe.

**Dependencies:** Slice 1 ownership/storage-key contract.

**Acceptance criteria**

1. Process memory does not scale with file size during upload.
2. `File.size > 2147483648` is rejected before a browser request starts, and bypassing that guard still meets independent backend streaming rejection.
3. Oversize, over-duration, corrupt, no-audio, multi-audio-stream, and unsupported sources are rejected before retained-audio storage, queue/run creation, and paid STT.
4. Supported direct audio is stored byte-identically as the one retained artifact.
5. Allowed MP4/MOV/WebM fixtures stream-copy without codec/channel change, are re-probed, retain only extracted audio on a miss, and leave no source video locally or remotely.
6. A valid same-workspace cache hit performs no retained-audio upload and creates/enqueues no run/job.
7. All temporary files are removed on cache hit, success, rejection, disconnect, timeout, preparation failure, and storage failure.

**Validation gates**

1. Generated fixtures at limit boundaries plus corrupt/truncated/no-audio/multiple-audio cases.
2. Browser no-request test for the configured 2 GiB guard plus backend bounded-streaming instrumentation using a 100 MiB synthetic upload. The latter proves chunk-bounded architecture, not a product size limit.
3. Exact production Docker runtime FFmpeg copy/probe integration gate; disable video acceptance if it fails.
4. Trusted split mono/stereo/channel-order regression tests, including the completed atomic topology upload test.
5. Terra/high review of media-policy determinism, subprocess safety, cleanup, and limit behavior.

### Slice 3 — Streaming provider submission

**Scope**

1. Extend the existing transcription storage seam to provide a submission source without buffering: fresh short-lived presigned URL for S3 and file-backed Blob/stream for local filesystem.
2. Update ElevenLabs Scribe v2 submission to use `sourceUrl` for S3 media and the probed real MIME/filename for local files. The installed `@elevenlabs/elevenlabs-js` 2.62.0 request type exposes `sourceUrl`, and its client serializes it as `source_url`; do not use the deprecated `cloudStorageUrl` field.
3. Remove the adapter's stream-to-Buffer collector and hard-coded `audio/mpeg` Blob.
4. Keep Deepgram trusted split on its existing streaming path while aligning the shared one-durable-submission-reservation-per-provider-dispatch contract; BullMQ delivery count is separate.

**Dependencies:** Slice 2 prepared-media contract.

**Acceptance criteria**

1. A synthetic large source reaches the adapter without whole-file heap growth.
2. Each attempt gets a fresh URL with adequate expiry; logs never contain the signed URL.
3. Direct audio and copied video-audio formats are submitted with correct provider semantics.
4. No provider-live calls are required in tests; mocked contract tests assert URL/file request shape.

**Validation gates:** adapter unit tests, storage integration tests for S3/filesystem variants, bounded-memory test, and Terra/high provider-boundary review.

### Slice 4 — Stable execution, claiming, retry, and transcript winner

**Status:** Implemented locally. The exceptional-risk semantic review is `CLOSED` with no remaining findings.

**Implemented architecture**

1. `recording_upload_operations` owns workspace-scoped logical upload identity before media consumption. The frontend-owned operation UUID is retained across ambiguous retry/resume reconciliation and rotated for intentional new or replacement uploads.
2. Each physical upload attempt uses an immutable, attempt-specific storage candidate. The recording/run transaction adopts exactly one winning candidate URI; obsolete unadopted candidates are isolated for bounded, retrying cleanup with a durable adoption/reference recheck.
3. Replace execution-wide advisory fencing with a short durable run claim lease. At the actual SDK transport boundary, a single-use guarded dispatch permit checks the current claim and committed slot, composes cancellation with the SDK signal, and prevents stale continuation dispatch.
4. Three durable submission reservations remain the paid-boundary ceiling for a run. BullMQ deliveries may exceed three during reconciliation/recovery and are not the provider-call budget; provider-library retries remain disabled.
5. Permanent, transient, ambiguous, and malformed outcomes use objective classification. A malformed Deepgram success enters bounded recovery, and reservation exhaustion commits terminal state before publishing only the committed terminal projection.
6. Transcript winner and run/recording success commit atomically. The server rejects active/successful normal retry; removal of normal-user transcription retry UI remains in Slice 5.

**Dependencies:** Slice 1 run schema and Slice 3 provider source.

**Implemented behavior**

1. Concurrent duplicate enqueue and duplicate Bull delivery produce at most one live provider call for a run claim; a valid cache hit creates no run or job to duplicate.
2. No run reserves more than three submission slots that could possibly cross the paid boundary; BullMQ delivery attempts may exceed three, and tests and observability do not claim reservations equal exact physical submissions.
3. Injected transient, ambiguous, crash-recovery, and malformed outcomes retry and eventually succeed or terminally exhaust as specified; malformed provider success is never accepted as a transcript winner.
4. Permanent failures do not retry.
5. Competing completion cannot write two transcripts.
6. Success and active runs cannot be retried through the server; normal-user transcription retry UI is Slice 5 work.

**Validation gates**

1. Database-backed concurrency tests for enqueue and claim interleavings, stale claim recovery, and winner persistence.
2. BullMQ/Redis integration tests asserting delivery attempts versus durable slot reservation, including crash before/around the network boundary and stale ambiguous claim recovery.
3. Failure-matrix tests covering every category and the exact three-slot ceiling.
4. Narrow Sol/high review of concurrency, idempotency, retry transitions, paid-call bounds, and persistence integrity; Terra/high review of end-to-end worker integration.

### Slice 5 — Truthful frontend state and actionable recovery

**Scope**

1. Surface the canonical run/error projection through recording DTOs, polling, SSE, and resume payloads; every path must use the same server projection.
2. Render truthful `Checking`, `Waiting`, `Transcribing`, `Trying again`, `Ready`, and terminal `Recording needs attention` states with actionable copy.
3. Consume the existing Slice 2 browser `File.size > 2147483648` guard and stable backend error codes, including the shared `file_too_large` message; do not add a second size-policy implementation.
4. Expose `audioLifecycle`/`audioAvailable`, and render cache-hit `not_retained` recordings as ready without a fake run or audio control.
5. Remove normal-user transcription retry UI. Keep Slice 4's frontend-owned operation UUID and ambiguous upload retry/resume reconciliation intact; terminal recovery is re-upload/replace recording.
6. Ensure refresh/reconnect produces the same state as uninterrupted processing.

**Dependencies:** Slices 2 and 4 state/error contracts.

**Acceptance criteria:** route-visible tests cover the canonical DTO/polling/SSE/resume projection, client oversize rejection with no request, cache hit with no run/audio, `Checking`/`Waiting`/`Transcribing`/`Trying again`/`Ready`/terminal-attention states, stable error actions, normal retry removal, and refresh/reconnect equivalence; no normal flow asks for provider/topology/retry knowledge.

**Validation gates:** frontend unit/route-visible tests, API contract tests, manual browser smoke with injected backend states, and Terra/high UX/state integration review.

### Slice 6 — Source-confirmation deletion and stale cleanup

**Status:** Implemented locally; terminal validation and narrow Sol/high review pending.

**Scope**

1. Mark retained-audio deletion pending in the Source-confirmation transaction and make confirmed audio unavailable immediately.
2. Add the worker-owned, multi-replica-safe cleanup sweep and seven-day TTL policy.
3. Delete only the one recording-adopted retained-audio object idempotently while preserving recordings/transcripts/downstream text artifacts; exclude `not_retained` cache-hit rows. Slice 4 candidate cleanup remains separate and never belongs here.
4. Add cleanup config, startup validation, structured logs, deletion-specific attempt/error fields, retry behavior, and operator dry-run query/runbook.

**Dependencies:** Slice 1 ownership/lifecycle schema; may proceed alongside Slices 3–5 after that foundation.

**Acceptance criteria**

1. Confirmation commit always requests deletion for `retained` audio, including idempotent replay; `not_retained` remains unchanged and is never mislabeled `deleted`.
2. Playback is unavailable after confirmation even before physical delete.
3. Confirmed, failed, abandoned-review, and safely stale-processing cases clean according to policy.
4. Missing objects are success; transient delete failures increment only deletion-attempt/error fields and retry; transcript/recording rows remain.
5. One recording's cleanup cannot affect another tutor or cache lineage.

**Validation gates:** transactional confirmation tests, clock-controlled TTL tests, two-sweeper claim tests, storage delete failure/idempotency tests, retained transcript tests, synthetic S3/filesystem cleanup rehearsal, and narrow Sol/high review of destructive lifecycle, tenant scope, and persistent-state transitions.

### Slice 7 — Integrated acceptance, operations, and documentation closeout

**Scope**

1. Run the full Goal Contract matrix, including Docker media fixtures, database/Redis concurrency, tenant isolation, retry recovery, refresh/resume, and deletion.
2. Add only the cheap run/submission-slot/latency/outcome and audio-deletion operational queries and log guidance needed for rollout.
3. Synchronize package READMEs, API/env/operations docs, active transcription design, generated docs indexes, and plan lifecycle.
4. Perform an authorized staged production smoke after deployment; this plan does not itself authorize deployment or paid-provider calls.

**Dependencies:** all prior slices.

**Acceptance criteria:** every Completion evidence item has fresh local/CI evidence and separately authorized production evidence where local mocks cannot prove runtime integration.

**Validation gates**

1. Run focused local validation first. Do not require a local aggregate completion gate: choose one only
   for a concrete plausible wider failure, local environment behavior under test, unavailable equivalent
   hosted evidence, or a specific CI failure being reproduced or diagnosed. Diff breadth alone is not
   sufficient.
2. Hosted PR CI is the comprehensive merge gate. Run focused local evidence appropriate to the
   changed recording paths; do not automatically run a repository-wide local gate.
3. If hosted CI fails, inspect its logs/artifacts and reproduce that job's actual command,
   configuration, and prerequisites. Reuse still-fresh evidence and do not repeat diagnostic runs
   without a relevant state change.
4. Selected PostgreSQL/Redis hosted lanes and the `CI gate` remain merge evidence where applicable.
5. `pnpm release:verify:contracts`, backend baseline verification, docs index generation, formatting, repository hygiene, and docs checks remain required where their paths are affected.
6. One final Terra/high whole-branch review for cross-boundary regressions after the three narrow Sol/high risk reviews are resolved.

## 11. Migration, deployment, and rollback considerations

### Migration and rollout

1. Migrations 0049–0053 are additive until their guarded workspace backfill, upload-operation ownership, candidate-cleanup, retained-audio backfill, and constraints are verified. Before deployment, run a production read-only preflight for recordings without resolvable student workspaces, duplicate transcripts, active legacy jobs, storage-key distribution, obsolete upload candidates, and retained-audio cleanup candidates.
2. Rehearse the migration on a current production snapshot/synthetic clone. Do not resolve ambiguous ownership automatically; stop for operator mapping or quarantine.
3. Deploy compatible API and worker images together after migration. Do not let an old unscoped API remain active against the new tenant contract.
4. Confirm runtime FFmpeg/ffprobe availability, writable temp capacity for configured upload concurrency and the 2 GiB source-file operational limit plus the 10 GiB local-disk reserve, S3 Get/Put/Delete permissions, and presigned URL reachability from ElevenLabs.
5. Enable ordinary audio first. Enable cheap video formats only after the exact production-image copy probe passes.
6. Keep cleanup disabled initially, inspect candidate counts, run synthetic deletion, then enable it and verify confirmed audio becomes inaccessible/deleted while transcripts remain.
7. Provider-live smoke and production mutation require separate explicit authorization.

### Rollback

1. Keep migrations 0049–0053 and durable transcript/run data; do not down-migrate or delete evidence.
2. Do not roll back to an API version that permits cross-workspace access. If tenant correctness is uncertain, disable recording intake/worker processing and deploy a forward fix.
3. A media-preparation problem may be rolled back by narrowing the allowlist to direct audio while preserving tenant/run/retention contracts.
4. A provider submission or retry problem may pause worker consumption; it must not switch providers automatically or reset reserved submission slots.
5. A cleanup problem is contained by disabling `RECORDING_AUDIO_CLEANUP_ENABLED`; pending rows and text artifacts remain for a forward repair.

## 12. Documentation lifecycle

### Update during implementation

1. Active transcription/runtime docs and `packages/batch-backend`/STT package READMEs: fixed routes, request profiles, media policy, run/retry semantics, ownership, and retention.
2. Environment reference/example: configurable 2 GiB source-file operational limit, 10 GiB local-disk reserve, 100-minute duration policy, seven-day TTL, cleanup enablement, probe deadline/temp requirements, and provider submission prerequisites.
3. API/frontend docs: normal upload states, stable error codes, no successful retry, advanced trusted split.
4. Operations docs: migration preflight, queue/run inspection, submission-slot/latency/outcome logs, cleanup rehearsal, and rollback.

### Supersede/archive/retain

1. This plan supersedes the still-useful implementation portions of `docs/superpowers/specs/2026-07-18-audio-ingest-expansion-design.md` and `docs/superpowers/plans/2026-07-18-audio-ingest-expansion.md`. Retain them as historical design evidence, but do not implement their generalized normalization, topology inference, broad container framework, or provider-routing ambitions.
2. Archive the completed `2026-08-30-elevenlabs-mixed-production-adoption.md`; retain its topology, request-profile, cache-fingerprint, speaker-role confirmation, and provider-choice rationale as historical trace. This plan owns remaining production readiness.
3. Update the topic README to make this the sole active implementation plan and remove obsolete Google/provider-comparison wording from its current summary/acceptance gates.
4. Retain the current private benchmark harness and aggregate reports as decision evidence. Keep them out of CI and never use private lesson media for ingest tests.
5. Retain the benchmark/media probe tooling only where it offers deterministic synthetic fixture generation. Product media probing belongs in the small backend boundary, not the benchmark package.
6. On Goal completion, move this plan to `docs/archive/plans/...`, update routers/indexes, and leave shipped contracts in active reference/operations/package docs.

## 13. Explicit deferred work

1. Any increase above the configured 2 GiB operational source-file limit or 100 minutes; revisit only with observed tutor files and capacity/cost evidence.
2. Additional container/codec pairs, audio-stream selection UI, or re-encoding/transcoding.
3. Lessons with more than one student/tutor or speaker-count inference.
4. Automatic topology/role inference, AEC, native capture, platform integrations, and realtime STT.
5. Automatic cross-provider fallback or renewed provider benchmarking.
6. Subjective transcript quality scoring, human retry choices, or exact-once provider billing.
7. General telemetry/billing dashboards, per-tutor quotas, or chargeback.
8. ElevenLabs Zero Retention and broad RLS activation unless separately required.

## 14. Remaining execution blockers

No maintainer product decision remains open.

The following are mandatory evidence gates, not architecture blockers:

1. Preserve the locally integrated `codex/audio-topology` atomic upload fix and its regression test through subsequent validation and release evidence.
2. Run the production read-only migration preflight. Any recording that cannot be mapped to exactly one workspace, or any duplicate transcript winner, requires explicit operator resolution before `NOT NULL`/unique enforcement.
3. Preserve the passing exact-production-runtime synthetic MP4/MOV/WebM stream-copy gate for the
   deployed image. A changed or failing image ships direct audio only and defers video convenience.
4. Preserve the mocked installed-SDK `sourceUrl -> source_url` request-shape proof, then use one
   separately authorized production smoke to prove ElevenLabs can fetch the actual presigned S3 URL.
   A runtime fetch failure is a rollout gate to diagnose, not permission to restore whole-file
   buffering.
