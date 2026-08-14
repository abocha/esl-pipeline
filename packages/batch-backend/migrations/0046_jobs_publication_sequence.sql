-- A successful HTML publication receives a lineage-local, monotonic sequence.
-- Existing publications predate this ordering contract and retain the neutral
-- value; future successful publishes are assigned under their lineage lock.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS publication_sequence BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_jobs_publication_sequence
  ON jobs (publication_sequence)
  WHERE publication_sequence > 0;
