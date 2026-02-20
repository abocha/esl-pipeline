-- Phase 5: RLS readiness artifacts.
-- This migration creates policy/helper prerequisites only.
-- RLS is intentionally not enabled in this phase.

CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.user_id', true), '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN NULLIF(current_setting('app.user_id', true), '')::uuid
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.app_current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_role', true), '')
$$;

CREATE OR REPLACE FUNCTION public.app_rls_bypass()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.rls_bypass', true), ''), 'off') = 'on'
$$;

DROP POLICY IF EXISTS users_self_access_policy ON users;
CREATE POLICY users_self_access_policy ON users
FOR ALL
TO PUBLIC
USING (
  public.app_rls_bypass()
  OR id = public.app_current_user_id()
)
WITH CHECK (
  public.app_rls_bypass()
  OR id = public.app_current_user_id()
);

DROP POLICY IF EXISTS jobs_user_scope_policy ON jobs;
CREATE POLICY jobs_user_scope_policy ON jobs
FOR ALL
TO PUBLIC
USING (
  public.app_rls_bypass()
  OR user_id = public.app_current_user_id()
)
WITH CHECK (
  public.app_rls_bypass()
  OR user_id = public.app_current_user_id()
);

DROP POLICY IF EXISTS uploaded_files_user_scope_policy ON uploaded_files;
CREATE POLICY uploaded_files_user_scope_policy ON uploaded_files
FOR ALL
TO PUBLIC
USING (
  public.app_rls_bypass()
  OR user_id = public.app_current_user_id()
)
WITH CHECK (
  public.app_rls_bypass()
  OR user_id = public.app_current_user_id()
);

DROP POLICY IF EXISTS user_settings_user_scope_policy ON user_settings;
CREATE POLICY user_settings_user_scope_policy ON user_settings
FOR ALL
TO PUBLIC
USING (
  public.app_rls_bypass()
  OR user_id = public.app_current_user_id()
)
WITH CHECK (
  public.app_rls_bypass()
  OR user_id = public.app_current_user_id()
);
