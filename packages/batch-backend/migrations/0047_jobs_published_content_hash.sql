-- Stores the exact UTF-8 Markdown digest that was available to a successful
-- publication worker. Historical jobs remain nullable for read compatibility.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS published_content_hash TEXT;
