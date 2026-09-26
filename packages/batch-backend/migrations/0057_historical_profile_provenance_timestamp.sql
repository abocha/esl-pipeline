-- A historical provenance backfill changes classification metadata only. Preserve the
-- profile content/update timestamp when those are the only two changed fields.
CREATE OR REPLACE FUNCTION set_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.provenance = 'unknown'
     AND NEW.provenance = 'evidence_enriched'
     AND OLD.initial_enrichment_completed_at IS NULL
     AND NEW.initial_enrichment_completed_at IS NOT NULL
     AND (to_jsonb(NEW) - 'provenance' - 'initial_enrichment_completed_at') =
         (to_jsonb(OLD) - 'provenance' - 'initial_enrichment_completed_at') THEN
    RETURN NEW;
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
