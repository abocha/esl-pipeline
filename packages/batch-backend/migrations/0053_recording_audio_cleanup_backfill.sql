-- Keep the Source-confirmation deletion request atomic during rolling deployment,
-- including confirmations briefly written by the previous application version.
CREATE OR REPLACE FUNCTION request_confirmed_source_audio_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE recordings r SET audio_lifecycle = 'pending',
      audio_deletion_requested_at = COALESCE(r.audio_deletion_requested_at, NOW()),
      updated_at = NOW()
  WHERE r.id = NEW.recording_id
    AND r.student_id = NEW.student_id
    AND r.id::text = NEW.confirmed_snapshot #>> '{source,recordingId}'
    AND r.audio_lifecycle = 'retained';
  RETURN NEW;
END $$;

CREATE TRIGGER assignment_sessions_confirmed_source_audio_deletion
AFTER INSERT OR UPDATE OF confirmed_snapshot, recording_id, student_id ON assignment_sessions
FOR EACH ROW EXECUTE FUNCTION request_confirmed_source_audio_deletion();

-- Source confirmations written before retained-audio cleanup existed must become
-- unavailable without requiring a tutor to replay the confirmation.
UPDATE recordings r
SET audio_lifecycle = 'pending',
    audio_deletion_requested_at = COALESCE(r.audio_deletion_requested_at, NOW()),
    updated_at = NOW()
WHERE r.audio_lifecycle = 'retained'
  AND EXISTS (
    SELECT 1
    FROM assignment_sessions s
    WHERE s.recording_id = r.id
      AND s.student_id = r.student_id
      AND s.confirmed_snapshot #>> '{source,recordingId}' = r.id::text
  );
