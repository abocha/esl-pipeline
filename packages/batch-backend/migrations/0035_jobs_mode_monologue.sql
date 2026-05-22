ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_mode_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_mode_check
  CHECK (mode IS NULL OR mode IN ('auto', 'dialogue', 'monologue', 'tts'));
