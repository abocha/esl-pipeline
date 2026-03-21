CREATE TABLE IF NOT EXISTS student_profile_candidate_draft_revisions (
  candidate_id UUID NOT NULL REFERENCES student_profile_candidates(id) ON DELETE CASCADE,
  revision_id UUID NOT NULL REFERENCES profile_revisions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (candidate_id, revision_id)
);

CREATE INDEX IF NOT EXISTS idx_student_profile_candidate_draft_revisions_revision
  ON student_profile_candidate_draft_revisions (revision_id, candidate_id);
