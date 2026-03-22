CREATE TABLE IF NOT EXISTS student_profile_candidates (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  target_section TEXT NOT NULL,
  candidate_key TEXT NOT NULL,
  fact TEXT NOT NULL,
  approved_fact TEXT NULL,
  category TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence TEXT NOT NULL,
  review_needed BOOLEAN NOT NULL DEFAULT TRUE,
  source_snapshot_id UUID NULL REFERENCES student_memory_snapshots(id) ON DELETE SET NULL,
  source_lesson_memory_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_state TEXT NOT NULL DEFAULT 'unreviewed',
  reviewer_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewer_note TEXT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  promoted_revision_id UUID NULL REFERENCES profile_revisions(id) ON DELETE SET NULL,
  promoted_at TIMESTAMPTZ NULL,
  superseded_by_id UUID NULL REFERENCES student_profile_candidates(id) ON DELETE SET NULL,
  superseded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_profile_candidates_target_section_check'
  ) THEN
    ALTER TABLE student_profile_candidates
      ADD CONSTRAINT student_profile_candidates_target_section_check
      CHECK (
        target_section IN (
          'goals_motivation',
          'work_communication_context',
          'interests_personal_context',
          'learning_preferences_study_habits',
          'long_running_strengths',
          'persistent_challenges_constraints'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_profile_candidates_authority_check'
  ) THEN
    ALTER TABLE student_profile_candidates
      ADD CONSTRAINT student_profile_candidates_authority_check
      CHECK (authority IN ('teacher_confirmed', 'student_stated', 'model_inferred'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_profile_candidates_confidence_check'
  ) THEN
    ALTER TABLE student_profile_candidates
      ADD CONSTRAINT student_profile_candidates_confidence_check
      CHECK (confidence IN ('low', 'medium', 'high'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_profile_candidates_status_check'
  ) THEN
    ALTER TABLE student_profile_candidates
      ADD CONSTRAINT student_profile_candidates_status_check
      CHECK (status IN ('pending_review', 'approved', 'rejected', 'promoted', 'superseded'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_profile_candidates_review_state_check'
  ) THEN
    ALTER TABLE student_profile_candidates
      ADD CONSTRAINT student_profile_candidates_review_state_check
      CHECK (review_state IN ('unreviewed', 'deferred', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_profile_candidates_student_created_at
  ON student_profile_candidates (student_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_student_profile_candidates_student_status_created_at
  ON student_profile_candidates (student_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_student_profile_candidates_student_review_state_created_at
  ON student_profile_candidates (student_id, review_state, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_student_profile_candidates_student_candidate_key
  ON student_profile_candidates (student_id, candidate_key, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION set_student_profile_candidates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_student_profile_candidates_updated_at ON student_profile_candidates;

CREATE TRIGGER set_student_profile_candidates_updated_at
BEFORE UPDATE ON student_profile_candidates
FOR EACH ROW
EXECUTE FUNCTION set_student_profile_candidates_updated_at();
