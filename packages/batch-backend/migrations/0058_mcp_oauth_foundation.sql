-- Durable oidc-provider artifacts. Keys are SHA-256 digests so bearer tokens and
-- authorization codes are never stored as lookup keys in plaintext.
CREATE TABLE mcp_oauth_artifacts (
  kind TEXT NOT NULL,
  id_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  grant_id TEXT,
  uid TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  PRIMARY KEY (kind, id_hash)
);

CREATE INDEX mcp_oauth_artifacts_grant_idx ON mcp_oauth_artifacts (kind, grant_id);
CREATE INDEX mcp_oauth_artifacts_uid_idx ON mcp_oauth_artifacts (kind, uid)
  WHERE uid IS NOT NULL;
CREATE INDEX mcp_oauth_artifacts_expiry_idx ON mcp_oauth_artifacts (expires_at);

CREATE TABLE mcp_oauth_grants (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope = 'teaching_context.read'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mcp_oauth_grants_user_idx ON mcp_oauth_grants (user_id);
