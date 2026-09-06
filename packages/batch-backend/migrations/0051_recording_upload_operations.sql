-- A browser retry identity is workspace scoped, while recordings keep their
-- globally generated identifiers. Keep the incomplete upload lifecycle out of
-- recordings so an uncommitted writer cannot own a canonical audio object.
CREATE TABLE recording_upload_operations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  operation_uuid uuid NOT NULL,
  recording_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  audio_topology text NOT NULL,
  requested_provider text NULL,
  request_profile text NOT NULL,
  state text NOT NULL DEFAULT 'processing',
  attempt_token uuid NULL,
  attempt_expires_at timestamptz NULL,
  final_recording_id uuid NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recording_upload_operations_workspace_operation_unique UNIQUE (workspace_id, operation_uuid),
  CONSTRAINT recording_upload_operations_state_check CHECK (state IN ('processing', 'completed')),
  CONSTRAINT recording_upload_operations_completed_check CHECK (
    (state = 'completed' AND final_recording_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (state = 'processing' AND final_recording_id IS NULL AND completed_at IS NULL)
  )
);

CREATE TABLE recording_upload_operation_attempts (
  operation_id uuid NOT NULL REFERENCES recording_upload_operations(id) ON DELETE CASCADE,
  attempt_token uuid NOT NULL,
  state text NOT NULL DEFAULT 'active',
  candidate_uri text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz NULL,
  PRIMARY KEY (operation_id, attempt_token),
  CONSTRAINT recording_upload_operation_attempts_state_check CHECK (state IN ('active', 'obsolete', 'adopted'))
);

CREATE INDEX idx_recording_upload_operation_attempts_obsolete
  ON recording_upload_operation_attempts (state, retired_at)
  WHERE state = 'obsolete';
