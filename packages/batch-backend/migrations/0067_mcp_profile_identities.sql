-- Connection identity is independent of grants, tokens and membership lifetime.
-- Individual user/workspace deletion retires the identity; UUIDs are never reused.
CREATE TABLE mcp_profile_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE (user_id, workspace_id)
);

CREATE FUNCTION reject_mcp_profile_identity_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'MCP profile identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER mcp_profile_identity_immutable
BEFORE UPDATE ON mcp_profile_identities
FOR EACH ROW EXECUTE FUNCTION reject_mcp_profile_identity_update();

-- Include expired/revoked grants and identities without current membership, too:
-- reauthorization of the same pair must resolve to the same profile.
INSERT INTO mcp_profile_identities (user_id, workspace_id)
SELECT DISTINCT user_id, workspace_id FROM mcp_oauth_grants;
