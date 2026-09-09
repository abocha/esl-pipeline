# Recording Audio Cleanup Rehearsal

## Purpose

Use this runbook before enabling deletion of recording-adopted retained audio. It does not cover the
separate Slice 4 cleanup of obsolete, unadopted upload-attempt candidates.

## Safety boundary

Keep `RECORDING_AUDIO_CLEANUP_ENABLED=false` during inspection and rehearsal. The recording sweeper
deletes only the URI durably selected by `recordings.storage_uri`, after validating its workspace and
recording path. It preserves recording, transcript, Source snapshot, lesson-memory, and downstream
assignment data.

## Inspect candidates

Run this read-only query against the intended environment with the same TTL that will be configured.
It groups current candidates without claiming or changing them.

```sql
WITH policy AS (
  SELECT 7::integer AS recovery_ttl_days
), candidates AS (
  SELECT r.id,
    CASE
      WHEN r.error = 'transcription_stale' THEN 'safely_stale_processing'
      WHEN r.audio_lifecycle = 'pending' THEN 'source_confirmed'
      WHEN EXISTS (
        SELECT 1 FROM assignment_sessions s
        WHERE s.recording_id = r.id
          AND s.student_id = r.student_id
          AND s.confirmed_snapshot #>> '{source,recordingId}' = r.id::text
      ) THEN 'source_confirmed'
      WHEN r.status = 'failed' THEN 'failed_ttl'
      WHEN r.status = 'transcribed' THEN 'unconfirmed_transcribed_ttl'
      ELSE 'safely_stale_processing'
    END AS cleanup_reason
  FROM recordings r, policy p
  WHERE r.storage_uri IS NOT NULL
    AND (
      r.audio_lifecycle = 'pending'
      OR (
        r.audio_lifecycle = 'retained'
        AND EXISTS (
          SELECT 1 FROM assignment_sessions s
          WHERE s.recording_id = r.id
            AND s.student_id = r.student_id
            AND s.confirmed_snapshot #>> '{source,recordingId}' = r.id::text
        )
      )
      OR (
        r.audio_lifecycle IN ('deleting', 'delete_failed')
        AND r.audio_deletion_next_attempt_at <= now()
      )
      OR (
        r.audio_lifecycle = 'retained'
        AND r.status IN ('failed', 'transcribed')
        AND r.updated_at <= now() - (p.recovery_ttl_days * interval '1 day')
      )
      OR (
        r.audio_lifecycle = 'retained'
        AND r.status IN ('queued', 'transcribing')
        AND r.updated_at <= now() - (p.recovery_ttl_days * interval '1 day')
        AND NOT EXISTS (
          SELECT 1 FROM transcription_runs tr
          WHERE tr.recording_id = r.id
            AND tr.state IN ('queued', 'claimed', 'submitting', 'retry_wait')
        )
      )
    )
)
SELECT cleanup_reason, count(*) AS candidate_count
FROM candidates
GROUP BY cleanup_reason
ORDER BY cleanup_reason;
```

Replace only the `7` in the `policy` CTE when rehearsing another approved TTL. Inspect individual
rows with a separate read-only query before changing configuration; do not print signed URLs or
audio/transcript content in shared logs.

## Synthetic rehearsal and enablement

1. Confirm cleanup is disabled in the worker's effective configuration.
2. In a disposable test workspace, upload synthetic non-user audio and confirm Source. Verify the
   recording DTO reports `audioLifecycle=pending`, `audioAvailable=false`, and the authenticated
   audio endpoint returns the ordinary scoped not-found response while the object still exists.
3. Rehearse storage deletion against that synthetic object with the same filesystem or S3 identity
   and permissions used by the worker. Verify a repeated delete succeeds when the object is absent.
4. Re-run the candidate-count query and record the expected reason counts.
5. Set `RECORDING_AUDIO_CLEANUP_ENABLED=true`, recreate only the transcribe worker, and watch
   structured `recording_audio_cleanup_transition` events for the synthetic recording.
6. Verify the synthetic recording becomes `deleted`, `storage_uri` is cleared, and its transcript,
   confirmed Source snapshot, and downstream text lineage remain readable.

If cleanup behaves unexpectedly, set `RECORDING_AUDIO_CLEANUP_ENABLED=false` and recreate the
transcribe worker. Pending and failed durable rows remain available for a forward repair; do not
down-migrate or delete accounting rows.
