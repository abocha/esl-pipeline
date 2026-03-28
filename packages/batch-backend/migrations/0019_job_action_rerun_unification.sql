DO $$
DECLARE
  current_definition TEXT;
BEGIN
  UPDATE job_action_history
  SET action_type = 'rerun'
  WHERE action_type IN ('rerun_audio', 'rerun_publish');

  SELECT pg_get_constraintdef(oid)
  INTO current_definition
  FROM pg_constraint
  WHERE conname = 'job_action_history_action_type_check'
  LIMIT 1;

  IF current_definition IS NULL THEN
    ALTER TABLE job_action_history
      ADD CONSTRAINT job_action_history_action_type_check
      CHECK (action_type IN ('rerun', 'cancel', 'edit_metadata'));
  ELSIF position('rerun_publish' in current_definition) > 0
     OR position('rerun_audio' in current_definition) > 0
     OR position('''rerun''' in current_definition) = 0 THEN
    ALTER TABLE job_action_history
      DROP CONSTRAINT job_action_history_action_type_check;
    ALTER TABLE job_action_history
      ADD CONSTRAINT job_action_history_action_type_check
      CHECK (action_type IN ('rerun', 'cancel', 'edit_metadata'));
  END IF;
END $$;
