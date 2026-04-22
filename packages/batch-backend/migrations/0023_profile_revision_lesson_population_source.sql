ALTER TABLE public.profile_revisions
  DROP CONSTRAINT IF EXISTS profile_revisions_source_check;

ALTER TABLE public.profile_revisions
  ADD CONSTRAINT profile_revisions_source_check CHECK (
    source = ANY (
      ARRAY[
        'create'::text,
        'update'::text,
        'restore'::text,
        'starter_profile_form'::text,
        'candidate_promotion'::text,
        'legacy_normalization'::text,
        'lesson_population'::text
      ]
    )
  );
