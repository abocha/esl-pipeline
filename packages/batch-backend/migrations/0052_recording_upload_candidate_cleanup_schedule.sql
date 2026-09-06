-- Retain successful cleanup rows for a bounded revisit: storage can complete
-- after an earlier no-op deletion. Deferring both outcomes also prevents one
-- old prefix from monopolizing bounded reconciliation passes.
ALTER TABLE recording_upload_operation_attempts
ADD COLUMN cleanup_next_attempt_at timestamptz NOT NULL DEFAULT now();

DROP INDEX idx_recording_upload_operation_attempts_obsolete;

CREATE INDEX idx_recording_upload_operation_attempts_obsolete
ON recording_upload_operation_attempts (
    state, cleanup_next_attempt_at, retired_at
)
WHERE state = 'obsolete';
