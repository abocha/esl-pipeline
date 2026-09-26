-- Historical rows have no reliable authorship evidence. New ordinary profiles
-- explicitly opt into tutor_only at creation time.
ALTER TABLE profiles
  ADD COLUMN provenance text NOT NULL DEFAULT 'unknown',
  ADD COLUMN initial_enrichment_completed_at timestamptz,
  ADD CONSTRAINT profiles_provenance_check
    CHECK (provenance IN ('unknown', 'tutor_only', 'evidence_enriched')),
  ADD CONSTRAINT profiles_enrichment_completion_check
    CHECK ((provenance = 'evidence_enriched') = (initial_enrichment_completed_at IS NOT NULL));

CREATE TABLE profile_initial_enrichment_operations (
  id uuid PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  assignment_session_id uuid NOT NULL REFERENCES assignment_sessions(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE RESTRICT,
  transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE RESTRICT,
  transcript_storage_uri text NOT NULL,
  transcript_hash text NOT NULL,
  source_identity_kind text NOT NULL,
  source_fingerprint_scheme text NOT NULL,
  source_fingerprint text NOT NULL,
  lesson_memory_entry_id uuid REFERENCES lesson_memory_entries(id) ON DELETE RESTRICT,
  seed_revision_id uuid REFERENCES profile_revisions(id) ON DELETE RESTRICT,
  seed_revision_hash text,
  generation_input jsonb,
  generation_provider text,
  generation_model text,
  state text NOT NULL DEFAULT 'waiting_evidence',
  submission_id uuid,
  submission_reserved_at timestamptz,
  validated_result jsonb,
  result_hash text,
  result_revision_id uuid REFERENCES profile_revisions(id) ON DELETE RESTRICT,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_initial_enrichment_state_check CHECK
    (state IN ('waiting_evidence', 'queued', 'submitting', 'result_ready',
               'succeeded', 'failed', 'uncertain', 'superseded')),
  CONSTRAINT profile_initial_enrichment_seed_pair_check CHECK
    ((seed_revision_id IS NULL) = (seed_revision_hash IS NULL)),
  CONSTRAINT profile_initial_enrichment_source_hash_check CHECK
    (transcript_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT profile_initial_enrichment_submission_check CHECK
    ((submission_id IS NULL) = (submission_reserved_at IS NULL)),
  CONSTRAINT profile_initial_enrichment_result_check CHECK
    ((validated_result IS NULL) = (result_hash IS NULL)),
  CONSTRAINT profile_initial_enrichment_success_check CHECK
    (state <> 'succeeded' OR result_revision_id IS NOT NULL)
);

CREATE UNIQUE INDEX profile_initial_enrichment_live_profile_idx
  ON profile_initial_enrichment_operations(profile_id)
  WHERE state IN ('waiting_evidence', 'queued', 'submitting', 'result_ready', 'uncertain');
CREATE UNIQUE INDEX profile_initial_enrichment_success_profile_idx
  ON profile_initial_enrichment_operations(profile_id)
  WHERE state = 'succeeded';
CREATE UNIQUE INDEX profile_initial_enrichment_exact_source_idx
  ON profile_initial_enrichment_operations(profile_id, assignment_session_id,
                                           transcript_id, transcript_hash);
CREATE INDEX profile_initial_enrichment_reconcile_idx
  ON profile_initial_enrichment_operations(state, updated_at)
  WHERE state IN ('waiting_evidence', 'queued', 'submitting', 'result_ready');
