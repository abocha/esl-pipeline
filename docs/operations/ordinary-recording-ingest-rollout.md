# Ordinary Recording Ingest Rollout

Source review: migrations `0049`-`0053` are a historical recording-ingest feature chain. The current
packaged migration set and each migration's compatibility must be resolved from
[`migrations/runtime-compatibility.json`](../../packages/batch-backend/migrations/runtime-compatibility.json)
and the packaged migration files before planning any apply. The recording ingest/runtime and cleanup
controls remain owned by the current backend implementation and [env reference](../reference/env.md).
The runbook's preflight, deletion and rollback gates remain useful only after reconciling the
deployed image/schema and operation with those current owners. No recording/run data or production
state was inspected. Migration and command presence proves neither residual work nor rollout
completion. Require current, separately authorized, record-bound evidence before use; keep cleanup
disabled until the current deletion safeguards have been rehearsed.

## Meta

- Audience: production operators and maintainers.
- Authority Level: active rollout and rollback procedure.
- Last Verified Against: 2026-09-09 `codex/audio-topology` closeout tree.
- Status: `runbook`.

## Safety boundary

Run all inspection queries read-only and save aggregate counts, not learner media or transcript text.
Production migration, deployment, provider calls, object deletion, and cleanup enablement require
separate operator authorization. Keep `RECORDING_AUDIO_CLEANUP_ENABLED=false` until the disabled-first
rehearsal is complete.

Migrations `0049_recording_ingest_readiness` through
`0053_recording_audio_cleanup_backfill` are additive. Do not edit an applied migration, down-migrate,
or auto-resolve ambiguous ownership/transcript winners.

## 1. Read-only migration preflight

Run these queries on production before applying 0049-0053. Any rows returned by the first two
queries stop the migration until an operator maps/quarantines the recording or selects the one
authoritative transcript winner.

```sql
-- Recordings whose student cannot establish exactly one workspace authority.
SELECT r.id AS recording_id, r.student_id, s.workspace_id
FROM recordings r
LEFT JOIN students s ON s.id = r.student_id
WHERE r.student_id IS NULL OR s.id IS NULL OR s.workspace_id IS NULL
ORDER BY r.created_at, r.id;

-- More than one current transcript winner for a recording.
SELECT recording_id, count(*) AS transcript_count, array_agg(id ORDER BY created_at, id) AS transcript_ids
FROM transcripts
GROUP BY recording_id
HAVING count(*) > 1
ORDER BY recording_id;

-- Recording-backed legacy application jobs still active during the cutover.
SELECT j.state, count(*) AS job_count
FROM jobs j
WHERE j.recording_id IS NOT NULL AND j.state IN ('queued', 'running')
GROUP BY j.state
ORDER BY j.state;

-- Pre-0049 retained-object scheme distribution without exposing object keys.
SELECT
  CASE
    WHEN storage_uri LIKE 's3://%' THEN 's3'
    WHEN storage_uri LIKE 'local://%' THEN 'local'
    WHEN storage_uri IS NULL THEN 'none'
    ELSE 'legacy_or_unknown'
  END AS storage_scheme,
  count(*) AS recording_count,
  coalesce(sum(bytes), 0) AS recorded_bytes
FROM recordings
GROUP BY storage_scheme
ORDER BY storage_scheme;
```

After 0049 is present, inspect active durable transcription work independently from legacy jobs:

```sql
SELECT state, provider, request_profile, count(*) AS run_count,
       max(now() - updated_at) AS oldest_update_age
FROM transcription_runs
WHERE state IN ('queued', 'claimed', 'submitting', 'retry_wait')
GROUP BY state, provider, request_profile
ORDER BY state, provider, request_profile;
```

Verify the planned chain against a production snapshot or synthetic clone before production:

```bash
pnpm --filter @esl-pipeline/batch-backend db:status
pnpm --filter @esl-pipeline/batch-backend db:verify
```

The expected head is `0053_recording_audio_cleanup_backfill`. Apply the migration only after the
read-only blockers are zero and the compatible API and transcribe-worker images are ready to deploy
together.

## 2. Runtime and capacity preflight

The API and transcribe worker require:

- Node 24 plus working `ffmpeg` and `ffprobe` binaries in the exact runtime image;
- a writable temp filesystem that can hold configured concurrent spools/extractions;
- `RECORDINGS_MAX_FILE_SIZE=2147483648` unless an operator intentionally chooses a stricter limit;
- `RECORDINGS_DISK_RESERVE_BYTES=10737418240` remaining after one maximum-size admission;
- the fixed 6000-second (100-minute) product duration ceiling;
- storage Put/Get/Delete access and recording-owned workspace prefixes;
- for S3, short-lived presigning and network reachability from ElevenLabs to the signed object URL.

Build and run the exact production backend runtime gate from the intended source revision:

```powershell
docker build --platform linux/amd64 --target runtime -f packages/batch-backend/Dockerfile `
  -t esl-pipeline-recording-media-gate:<revision> .
$gatePath = (Resolve-Path scripts/docker/verify-recording-media-runtime.sh).Path
docker run --rm --mount "type=bind,src=$gatePath,dst=/gate.sh,readonly" `
  --entrypoint sh esl-pipeline-recording-media-gate:<revision> /gate.sh
```

Confirm the image reports `linux/amd64`. Every JSON line must show the same input/output codec and
channel count, a duration delta no greater than 0.1 seconds, `outputHasVideo=false`,
`streamCopyMapping=true`, and `videoMapped=false`. A failure keeps video convenience disabled; it does
not authorize transcoding. Direct supported audio remains the safe rollout path.

The synthetic gate proves only MP4/AAC, MOV/AAC, and WebM/Opus. Zoom, Teams, Meet, Telemost,
LiveDigital, Jitsi, and OBS export compatibility remains unproven until representative exports are
probed in this image. Do not infer support from a filename or widen the allowlist without those facts.

## 3. Run, delivery, and submission inspection

`transcription_runs.submission_slots_reserved` is the conservative paid-boundary budget. A BullMQ
delivery is only an execution opportunity; reconciliation can create more deliveries than the three
reserved provider slots. Never infer provider-call count from BullMQ `attemptsMade`.

```sql
-- Current run state, conservative reservation use, and outcome/latency facts.
SELECT id, recording_id, workspace_id, provider, request_profile, state,
       submission_slots_reserved, submission_slot_limit, current_submission_slot,
       last_submission_outcome, error_code, provider_request_id,
       provider_latency_ms, total_latency_ms, claim_expires_at, updated_at
FROM transcription_runs
WHERE state IN ('queued', 'claimed', 'submitting', 'retry_wait', 'failed')
ORDER BY updated_at DESC
LIMIT 200;

-- Aggregate rollout signal without transcript or signed-URL content.
SELECT provider, request_profile, state, last_submission_outcome,
       submission_slots_reserved, count(*) AS run_count,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY provider_latency_ms)
         FILTER (WHERE provider_latency_ms IS NOT NULL) AS provider_latency_p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY provider_latency_ms)
         FILTER (WHERE provider_latency_ms IS NOT NULL) AS provider_latency_p95_ms
FROM transcription_runs
GROUP BY provider, request_profile, state, last_submission_outcome, submission_slots_reserved
ORDER BY provider, request_profile, state, submission_slots_reserved;
```

For a specific run, compare the durable row above with the configured `TRANSCRIBE_QUEUE_NAME` job
whose BullMQ `jobId` is the run UUID. Inspect queue state/`attemptsMade` through the existing queue
operator tooling; do not retry by editing either the queue job or reservation columns. Logs must not
contain a presigned URL. Terminal recovery for a normal tutor is re-upload/replacement, not successful
STT retry.

## 4. Upload-operation and candidate reconciliation

The browser-owned operation UUID is scoped by workspace and retained only across ambiguous retry or
resume. Physical candidates are attempt-specific and never shared.

```sql
SELECT o.workspace_id, o.state AS operation_state, count(*) AS operation_count,
       max(now() - o.updated_at) AS oldest_update_age
FROM recording_upload_operations o
GROUP BY o.workspace_id, o.state
ORDER BY o.workspace_id, o.state;

-- Obsolete candidates currently eligible for reconciliation. Counts only; do not delete by query.
SELECT o.workspace_id, count(*) AS candidate_count,
       min(a.cleanup_next_attempt_at) AS earliest_cleanup_at
FROM recording_upload_operation_attempts a
JOIN recording_upload_operations o ON o.id = a.operation_id
WHERE a.state = 'obsolete'
  AND a.candidate_uri IS NOT NULL
  AND a.cleanup_next_attempt_at <= now()
  AND NOT EXISTS (SELECT 1 FROM recordings r WHERE r.storage_uri = a.candidate_uri)
GROUP BY o.workspace_id
ORDER BY o.workspace_id;
```

The worker-owned reconciler must perform the final adoption/reference/current-attempt recheck. Never
use this query output as authority for manual object deletion.

## 5. Audio lifecycle and disabled-first cleanup

Use the detailed [recording audio cleanup rehearsal](recording-audio-cleanup.md). Before enablement,
inspect lifecycle totals and eligible candidates while cleanup remains disabled:

```sql
SELECT audio_lifecycle, status, count(*) AS recording_count,
       coalesce(sum(bytes), 0) AS recorded_bytes,
       max(audio_deletion_attempt_count) AS max_delete_attempts
FROM recordings
GROUP BY audio_lifecycle, status
ORDER BY audio_lifecycle, status;
```

Then run the exact read-only candidate-count CTE in
[`recording-audio-cleanup.md`](recording-audio-cleanup.md), setting its `policy.recovery_ttl_days` to
the intended configuration. That query also accounts for confirmed retained rows and safely stale
processing rows with no recoverable nonterminal run; do not replace it with a lifecycle-only count.

For local filesystem semantics, run the focused storage/sweeper tests against synthetic files. For
authorized staging S3 credentials, `storage:s3:smoke` creates a unique synthetic object, verifies
metadata and presigning, then deletes it by default:

```bash
pnpm --filter @esl-pipeline/batch-backend test -- \
  infrastructure.transcription-storage.test.ts application.sweep-recording-audio.test.ts
pnpm --filter @esl-pipeline/batch-backend storage:s3:smoke
```

Then, in a disposable staging workspace, upload synthetic non-user audio, confirm Source, verify the
API immediately reports audio unavailable while the object still exists, enable cleanup only for the
rehearsal worker, and observe `recording_audio_cleanup_transition`. Verify the recording reaches
`deleted`, `storage_uri` clears, and transcript/downstream text rows remain. Repeat deletion of the
already-absent synthetic object to verify idempotency.

Enable production cleanup only after candidate counts are understood, the synthetic filesystem/S3
path succeeds with production-equivalent permissions, and the seven-day TTL is confirmed. Roll back
by setting `RECORDING_AUDIO_CLEANUP_ENABLED=false` and recreating only the transcribe worker. Preserve
pending/error rows for a forward fix; never delete accounting or transcript rows.

## 6. Staged rollout evidence

After separately authorized deployment, record:

1. an ordinary supported audio upload through ready Source review;
2. the actual S3 presigned-URL fetch by ElevenLabs without logging the URL;
3. refresh/reconnect equality while queued, retrying, ready, and terminal;
4. Source-confirmation immediate audio unavailability followed by physical deletion;
5. retained transcript/downstream text after deletion;
6. representative export facts for each source family actually claimed as compatible.

Keep video disabled if the deployed image differs from the tested image or its exact media gate has
not passed. Keep cleanup disabled if deletion evidence is incomplete.
