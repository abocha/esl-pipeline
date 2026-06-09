CREATE TABLE IF NOT EXISTS alpha_invites (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  accepted_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT alpha_invites_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT alpha_invites_email_normalized_check
    CHECK (email_normalized = LOWER(BTRIM(email_normalized))),
  CONSTRAINT alpha_invites_expiration_check
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alpha_invites_pending_email_normalized
  ON alpha_invites (email_normalized)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_alpha_invites_status_expires_at
  ON alpha_invites (status, expires_at);

DROP INDEX IF EXISTS idx_students_student_lower_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_workspace_student_lower_unique
  ON students (workspace_id, LOWER(student));
