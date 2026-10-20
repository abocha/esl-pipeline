-- Google credentials never confer ESL login authority. Calendar attempts are browser scoped.
CREATE TABLE google_oauth_attempts (
  id uuid PRIMARY KEY,
  state_hash text NOT NULL UNIQUE,
  browser_binding_hash text NOT NULL,
  requesting_user_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  purpose text NOT NULL CHECK (purpose = 'connect-calendar'),
  verifier_encrypted text NOT NULL,
  nonce text NOT NULL,
  connection_id uuid,
  connection_generation integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','invalidated','completed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX google_oauth_attempts_browser_pending ON google_oauth_attempts(browser_binding_hash) WHERE status IN ('pending','claimed');

CREATE TABLE google_oauth_grants (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  authorizing_user_id uuid NOT NULL REFERENCES users(id),
  issuer text NOT NULL,
  subject text NOT NULL,
  client_id text NOT NULL,
  google_email text NOT NULL,
  granted_scopes text[] NOT NULL,
  refresh_credential text NOT NULL,
  access_credential text,
  access_expires_at timestamptz,
  credential_epoch integer NOT NULL DEFAULT 1 CHECK (credential_epoch > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reconnect_required','disconnected')),
  refresh_lease_token uuid,
  refresh_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, authorizing_user_id, issuer, subject, client_id),
  UNIQUE(id,workspace_id)
);

CREATE TABLE workspace_calendar_connections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  grant_id uuid NOT NULL,
  calendar_id text NOT NULL,
  calendar_name text NOT NULL,
  calendar_timezone text NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  status text NOT NULL CHECK (status IN ('connected','reconnect_required','disconnected')),
  sync_token text,
  sync_page_token text,
  sync_query jsonb NOT NULL DEFAULT '{"singleEvents":false,"showDeleted":true}'::jsonb,
  last_synced_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,workspace_id),
  FOREIGN KEY(grant_id,workspace_id) REFERENCES google_oauth_grants(id,workspace_id)
);
CREATE UNIQUE INDEX workspace_calendar_connections_workspace_active ON workspace_calendar_connections(workspace_id) WHERE status <> 'disconnected';
CREATE UNIQUE INDEX workspace_calendar_connections_remote_active ON workspace_calendar_connections(calendar_id) WHERE status <> 'disconnected';
ALTER TABLE google_oauth_attempts ADD CONSTRAINT google_oauth_attempts_connection_fkey FOREIGN KEY(connection_id,workspace_id) REFERENCES workspace_calendar_connections(id,workspace_id);

-- Irreversibly fence this personal grant on role loss, even if a role is restored before polling.
CREATE FUNCTION fence_calendar_authority_loss() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    IF OLD.is_active AND NOT NEW.is_active THEN
      UPDATE google_oauth_grants SET status='reconnect_required',credential_epoch=credential_epoch+1,refresh_lease_token=NULL,refresh_lease_expires_at=NULL WHERE authorizing_user_id=OLD.id AND status='active';
      UPDATE workspace_calendar_connections c SET status='reconnect_required',generation=generation+1,error_code='permission_changed',lease_token=NULL,lease_expires_at=NULL FROM google_oauth_grants g WHERE c.grant_id=g.id AND g.authorizing_user_id=OLD.id AND c.status='connected';
    END IF;
  ELSIF TG_OP = 'DELETE' OR (OLD.role IN ('owner','admin') AND NEW.role NOT IN ('owner','admin')) THEN
    UPDATE google_oauth_grants SET status='reconnect_required',credential_epoch=credential_epoch+1,refresh_lease_token=NULL,refresh_lease_expires_at=NULL WHERE authorizing_user_id=OLD.user_id AND workspace_id=OLD.workspace_id AND status='active';
    UPDATE workspace_calendar_connections c SET status='reconnect_required',generation=generation+1,error_code='permission_changed',lease_token=NULL,lease_expires_at=NULL FROM google_oauth_grants g WHERE c.grant_id=g.id AND g.authorizing_user_id=OLD.user_id AND c.workspace_id=OLD.workspace_id AND c.status='connected';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER calendar_membership_authority_loss AFTER UPDATE OF role OR DELETE ON workspace_memberships FOR EACH ROW EXECUTE FUNCTION fence_calendar_authority_loss();
CREATE TRIGGER calendar_user_authority_loss AFTER UPDATE OF is_active ON users FOR EACH ROW EXECUTE FUNCTION fence_calendar_authority_loss();
