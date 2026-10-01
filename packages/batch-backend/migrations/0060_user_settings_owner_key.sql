-- ABO-13 candidate 1: settings are private child state addressed only by user_id.
-- Serialize the inventory and DDL so a concurrent legacy writer cannot add a token
-- between the check and column removal. The migration runner owns the transaction.
LOCK TABLE user_settings IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_settings WHERE notion_token_encrypted IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot retire user_settings.notion_token_encrypted: legacy values require private export and approved disposition first';
  END IF;
END $$;

ALTER TABLE user_settings
  DROP CONSTRAINT user_settings_pkey,
  DROP CONSTRAINT user_settings_user_id_key,
  DROP COLUMN id,
  DROP COLUMN notion_token_encrypted,
  ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);
