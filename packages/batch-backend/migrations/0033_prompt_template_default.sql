ALTER TABLE public.templates
  ADD COLUMN is_default boolean DEFAULT false NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_single_default
  ON public.templates (is_default)
  WHERE is_default;
