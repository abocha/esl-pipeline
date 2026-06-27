ALTER TABLE profile_revisions
  DROP CONSTRAINT IF EXISTS profile_revisions_source_check;

ALTER TABLE profile_revisions
  ADD CONSTRAINT profile_revisions_source_check CHECK (
    source IN (
      'create',
      'update',
      'restore',
      'starter_profile_form',
      'candidate_promotion',
      'legacy_normalization',
      'lesson_population',
      'profile_revision_refresh'
    )
  );
