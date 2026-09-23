ALTER TABLE recordings
  ADD COLUMN source_identity_kind TEXT,
  ADD COLUMN source_fingerprint_scheme TEXT,
  ADD COLUMN source_fingerprint TEXT;

ALTER TABLE recording_upload_operations
  ADD COLUMN outcome_kind TEXT,
  ADD COLUMN canonical_assignment_session_id UUID REFERENCES assignment_sessions(id) ON DELETE RESTRICT;

UPDATE recording_upload_operations
SET outcome_kind = 'source_candidate'
WHERE state = 'completed';

ALTER TABLE recording_upload_operations
  DROP CONSTRAINT recording_upload_operations_completed_check,
  ADD CONSTRAINT recording_upload_operations_outcome_kind_check CHECK (
    outcome_kind IS NULL OR outcome_kind IN ('source_candidate', 'existing_assignment_resumed')
  ),
  ADD CONSTRAINT recording_upload_operations_completed_check CHECK (
    (state = 'processing'
      AND final_recording_id IS NULL
      AND canonical_assignment_session_id IS NULL
      AND outcome_kind IS NULL
      AND completed_at IS NULL)
    OR
    (state = 'completed'
      AND completed_at IS NOT NULL
      AND (
        (outcome_kind = 'source_candidate'
          AND final_recording_id IS NOT NULL
          AND canonical_assignment_session_id IS NULL)
        OR
        (outcome_kind = 'existing_assignment_resumed'
          AND final_recording_id IS NULL
          AND canonical_assignment_session_id IS NOT NULL)
      ))
  );

ALTER TABLE recordings
  ADD CONSTRAINT recordings_source_identity_complete_check CHECK (
    (source_identity_kind IS NULL AND source_fingerprint_scheme IS NULL AND source_fingerprint IS NULL)
    OR
    (source_identity_kind IN ('audio', 'manual_transcript')
      AND NULLIF(BTRIM(source_fingerprint_scheme), '') IS NOT NULL
      AND source_fingerprint ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT recordings_source_identity_kind_matches_source_check CHECK (
    source_identity_kind IS NULL
    OR (source = 'upload' AND source_identity_kind = 'audio')
    OR (source = 'manual_transcript' AND source_identity_kind = 'manual_transcript')
  );

UPDATE recordings
SET source_identity_kind = 'audio',
    source_fingerprint_scheme = 'prepared-media-sha256-v1',
    source_fingerprint = sha256
WHERE source = 'upload'
  AND sha256 ~ '^[0-9a-f]{64}$';

CREATE TABLE assignment_source_bindings (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  assignment_session_id UUID NOT NULL REFERENCES assignment_sessions(id) ON DELETE CASCADE,
  source_identity_kind TEXT NOT NULL,
  source_fingerprint_scheme TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  binding_role TEXT NOT NULL,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE RESTRICT,
  transcript_id UUID NOT NULL REFERENCES transcripts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assignment_source_bindings_identity_kind_check
    CHECK (source_identity_kind IN ('audio', 'manual_transcript')),
  CONSTRAINT assignment_source_bindings_fingerprint_check
    CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT assignment_source_bindings_role_check
    CHECK (binding_role IN ('confirmed', 'working'))
);

CREATE UNIQUE INDEX idx_assignment_source_bindings_scoped_source
  ON assignment_source_bindings (
    user_id, student_id, source_identity_kind, source_fingerprint_scheme, source_fingerprint
  );
CREATE UNIQUE INDEX idx_assignment_source_bindings_session_role
  ON assignment_source_bindings (assignment_session_id, binding_role);
CREATE INDEX idx_assignment_source_bindings_session
  ON assignment_source_bindings (assignment_session_id);

CREATE TABLE assignment_source_binding_audit (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  student_id UUID NOT NULL,
  source_identity_kind TEXT NOT NULL,
  source_fingerprint_scheme TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  prior_assignment_session_id UUID,
  canonical_assignment_session_id UUID NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assignment_source_binding_audit_action_check
    CHECK (action IN ('migration_conflict_resolution', 'operator_remap'))
);

CREATE INDEX idx_assignment_source_binding_audit_source
  ON assignment_source_binding_audit (
    user_id, student_id, source_identity_kind, source_fingerprint_scheme, source_fingerprint,
    created_at DESC
  );

-- Persist known identity in historical confirmed provenance. Unknown manual sources
-- deliberately remain unclassified rather than hashing editable transcript text.
UPDATE assignment_sessions s
SET confirmed_snapshot = jsonb_set(
      confirmed_snapshot,
      '{source}',
      (confirmed_snapshot -> 'source') || jsonb_build_object(
        'sourceIdentityKind', r.source_identity_kind,
        'sourceFingerprintScheme', r.source_fingerprint_scheme,
        'sourceFingerprint', r.source_fingerprint
      )
    )
FROM recordings r
WHERE s.confirmed_snapshot -> 'source' IS NOT NULL
  AND s.confirmed_snapshot -> 'source' <> 'null'::jsonb
  AND r.id = (s.confirmed_snapshot #>> '{source,recordingId}')::uuid
  AND r.source_identity_kind IS NOT NULL;

WITH candidates AS (
  SELECT
    s.id AS assignment_session_id,
    s.user_id,
    s.student_id,
    r.workspace_id,
    r.source_identity_kind,
    r.source_fingerprint_scheme,
    r.source_fingerprint,
    r.id AS recording_id,
    (s.confirmed_snapshot #>> '{source,transcriptId}')::uuid AS transcript_id,
    'confirmed'::text AS binding_role,
    CASE WHEN s.confirmed_step = 'share' THEN 3 ELSE 2 END AS authority_rank,
    s.created_at
  FROM assignment_sessions s
  JOIN recordings r ON r.id = (s.confirmed_snapshot #>> '{source,recordingId}')::uuid
  WHERE s.confirmed_snapshot -> 'source' IS NOT NULL
    AND s.confirmed_snapshot -> 'source' <> 'null'::jsonb
    AND r.source_identity_kind IS NOT NULL

  UNION ALL

  SELECT
    s.id,
    s.user_id,
    s.student_id,
    r.workspace_id,
    r.source_identity_kind,
    r.source_fingerprint_scheme,
    r.source_fingerprint,
    r.id,
    s.transcript_id,
    'working'::text,
    1,
    s.created_at
  FROM assignment_sessions s
  JOIN recordings r ON r.id = s.recording_id
  WHERE s.transcript_id IS NOT NULL
    AND r.source_identity_kind IS NOT NULL
    AND NOT (
      s.confirmed_snapshot -> 'source' IS NOT NULL
      AND s.confirmed_snapshot -> 'source' <> 'null'::jsonb
      AND (s.confirmed_snapshot #>> '{source,recordingId}')::uuid = s.recording_id
    )
), ranked AS (
  SELECT c.*,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, student_id, source_identity_kind,
        source_fingerprint_scheme, source_fingerprint
      ORDER BY authority_rank DESC, created_at ASC, assignment_session_id ASC
    ) AS source_rank,
    ROW_NUMBER() OVER (
      PARTITION BY assignment_session_id, binding_role
      ORDER BY authority_rank DESC, created_at ASC, recording_id ASC
    ) AS role_rank
  FROM candidates c
)
INSERT INTO assignment_source_bindings (
  id, workspace_id, user_id, student_id, assignment_session_id,
  source_identity_kind, source_fingerprint_scheme, source_fingerprint,
  binding_role, recording_id, transcript_id
)
SELECT gen_random_uuid(), workspace_id, user_id, student_id, assignment_session_id,
       source_identity_kind, source_fingerprint_scheme, source_fingerprint,
       binding_role, recording_id, transcript_id
FROM ranked
WHERE source_rank = 1 AND role_rank = 1;

WITH candidates AS (
  SELECT
    s.id AS assignment_session_id,
    s.user_id,
    s.student_id,
    r.workspace_id,
    r.source_identity_kind,
    r.source_fingerprint_scheme,
    r.source_fingerprint,
    CASE WHEN s.confirmed_step = 'share' THEN 3 ELSE 2 END AS authority_rank,
    s.created_at
  FROM assignment_sessions s
  JOIN recordings r ON r.id = (s.confirmed_snapshot #>> '{source,recordingId}')::uuid
  WHERE s.confirmed_snapshot -> 'source' IS NOT NULL
    AND s.confirmed_snapshot -> 'source' <> 'null'::jsonb
    AND r.source_identity_kind IS NOT NULL

  UNION ALL

  SELECT
    s.id, s.user_id, s.student_id, r.workspace_id,
    r.source_identity_kind, r.source_fingerprint_scheme, r.source_fingerprint,
    1, s.created_at
  FROM assignment_sessions s
  JOIN recordings r ON r.id = s.recording_id
  WHERE s.transcript_id IS NOT NULL
    AND r.source_identity_kind IS NOT NULL
    AND NOT (
      s.confirmed_snapshot -> 'source' IS NOT NULL
      AND s.confirmed_snapshot -> 'source' <> 'null'::jsonb
      AND (s.confirmed_snapshot #>> '{source,recordingId}')::uuid = s.recording_id
    )
), ranked AS (
  SELECT c.*,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, student_id, source_identity_kind,
        source_fingerprint_scheme, source_fingerprint
      ORDER BY authority_rank DESC, created_at ASC, assignment_session_id ASC
    ) AS source_rank,
    FIRST_VALUE(assignment_session_id) OVER (
      PARTITION BY user_id, student_id, source_identity_kind,
        source_fingerprint_scheme, source_fingerprint
      ORDER BY authority_rank DESC, created_at ASC, assignment_session_id ASC
    ) AS winner_session_id,
    FIRST_VALUE(authority_rank) OVER (
      PARTITION BY user_id, student_id, source_identity_kind,
        source_fingerprint_scheme, source_fingerprint
      ORDER BY authority_rank DESC, created_at ASC, assignment_session_id ASC
    ) AS winner_authority_rank,
    FIRST_VALUE(created_at) OVER (
      PARTITION BY user_id, student_id, source_identity_kind,
        source_fingerprint_scheme, source_fingerprint
      ORDER BY authority_rank DESC, created_at ASC, assignment_session_id ASC
    ) AS winner_created_at
  FROM candidates c
)
INSERT INTO assignment_source_binding_audit (
  id, workspace_id, user_id, student_id, source_identity_kind,
  source_fingerprint_scheme, source_fingerprint, prior_assignment_session_id,
  canonical_assignment_session_id, action, reason
)
SELECT
  gen_random_uuid(), workspace_id, user_id, student_id, source_identity_kind,
  source_fingerprint_scheme, source_fingerprint, assignment_session_id,
  winner_session_id, 'migration_conflict_resolution',
  CASE
    WHEN winner_authority_rank = 3 AND authority_rank < 3 THEN 'shared_owner_priority'
    WHEN winner_authority_rank = 2 AND authority_rank < 2 THEN 'confirmed_owner_priority'
    WHEN created_at > winner_created_at THEN 'earliest_creation_tiebreak'
    ELSE 'stable_session_id_tiebreak'
  END
FROM ranked
WHERE source_rank > 1;

ALTER TABLE lesson_memory_entries
  ADD COLUMN assignment_session_id UUID REFERENCES assignment_sessions(id) ON DELETE SET NULL;

UPDATE lesson_memory_entries lme
SET assignment_session_id = b.assignment_session_id
FROM assignment_source_bindings b
WHERE b.binding_role = 'confirmed'
  AND b.recording_id = lme.recording_id
  AND b.transcript_id = lme.transcript_id
  AND EXISTS (
    SELECT 1
    FROM assignment_sessions s
    WHERE s.id = b.assignment_session_id
      AND s.confirmed_snapshot #>> '{source,transcriptHash}' = lme.source_content_hash
  );

CREATE INDEX idx_lesson_memory_entries_assignment_session
  ON lesson_memory_entries (assignment_session_id, generated_at DESC, id DESC);

DROP INDEX IF EXISTS idx_assignment_sessions_user_active_recording;

DO $$
DECLARE
  audio_classified BIGINT;
  manual_classified BIGINT;
  unclassified BIGINT;
  bindings_created BIGINT;
  conflicts_resolved BIGINT;
  memory_backfilled BIGINT;
  memory_unknown BIGINT;
  shared_priority BIGINT;
  confirmed_priority BIGINT;
  earliest_tiebreak BIGINT;
  stable_id_tiebreak BIGINT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE source_identity_kind = 'audio'),
         COUNT(*) FILTER (WHERE source_identity_kind = 'manual_transcript'),
         COUNT(*) FILTER (WHERE source_identity_kind IS NULL)
  INTO audio_classified, manual_classified, unclassified
  FROM recordings;

  SELECT COUNT(*) INTO bindings_created FROM assignment_source_bindings;
  SELECT COUNT(*) INTO memory_backfilled
    FROM lesson_memory_entries WHERE assignment_session_id IS NOT NULL;
  SELECT COUNT(*) INTO memory_unknown
    FROM lesson_memory_entries WHERE assignment_session_id IS NULL;

  SELECT COUNT(*) FILTER (WHERE reason = 'shared_owner_priority'),
         COUNT(*) FILTER (WHERE reason = 'confirmed_owner_priority'),
         COUNT(*) FILTER (WHERE reason = 'earliest_creation_tiebreak'),
         COUNT(*) FILTER (WHERE reason = 'stable_session_id_tiebreak')
  INTO shared_priority, confirmed_priority, earliest_tiebreak, stable_id_tiebreak
  FROM assignment_source_binding_audit
  WHERE action = 'migration_conflict_resolution';

  WITH historical_candidates AS (
    SELECT s.user_id, s.student_id, r.source_identity_kind,
           r.source_fingerprint_scheme, r.source_fingerprint, COUNT(*) AS candidate_count
    FROM assignment_sessions s
    JOIN recordings r ON r.id = COALESCE(
      NULLIF(s.confirmed_snapshot #>> '{source,recordingId}', '')::uuid,
      s.recording_id
    )
    WHERE r.source_identity_kind IS NOT NULL
    GROUP BY s.user_id, s.student_id, r.source_identity_kind,
             r.source_fingerprint_scheme, r.source_fingerprint
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*) INTO conflicts_resolved FROM historical_candidates;

  RAISE NOTICE 'canonical source cutover: audio_classified=%, manual_classified=%, unclassified=%, bindings_created=%, historical_conflicts=%, lesson_memory_backfilled=%, lesson_memory_unknown=%',
    audio_classified, manual_classified, unclassified, bindings_created,
    conflicts_resolved, memory_backfilled, memory_unknown;
  RAISE NOTICE 'canonical source cutover winner reasons: shared_priority=%, confirmed_priority=%, earliest_tiebreak=%, stable_id_tiebreak=%',
    shared_priority, confirmed_priority, earliest_tiebreak, stable_id_tiebreak;
END $$;
