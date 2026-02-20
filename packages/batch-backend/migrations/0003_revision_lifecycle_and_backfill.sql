-- Normalize invalid statuses first
UPDATE profile_revisions
SET status = 'deprecated'
WHERE status IS NULL OR status NOT IN ('draft', 'active', 'deprecated');

UPDATE template_revisions
SET status = 'deprecated'
WHERE status IS NULL OR status NOT IN ('draft', 'active', 'deprecated');

-- Normalize version numbering and labels per profile
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY profile_id
      ORDER BY COALESCE(created_at, NOW()) ASC, id ASC
    ) AS rn
  FROM profile_revisions
)
UPDATE profile_revisions pr
SET
  version_number = ranked.rn,
  version_label = COALESCE(NULLIF(pr.version_label, ''), CONCAT('v', ranked.rn::text))
FROM ranked
WHERE pr.id = ranked.id;

-- Normalize version numbering and labels per template
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY template_id
      ORDER BY COALESCE(created_at, NOW()) ASC, id ASC
    ) AS rn
  FROM template_revisions
)
UPDATE template_revisions tr
SET
  version_number = ranked.rn,
  version_label = COALESCE(NULLIF(tr.version_label, ''), CONCAT('v', ranked.rn::text))
FROM ranked
WHERE tr.id = ranked.id;

-- Ensure a single active profile revision per profile
WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY profile_id
      ORDER BY COALESCE(activated_at, created_at, NOW()) DESC, id DESC
    ) AS rn
  FROM profile_revisions
  WHERE status = 'active'
)
UPDATE profile_revisions pr
SET
  status = 'deprecated',
  activated_at = NULL,
  deprecated_at = COALESCE(pr.deprecated_at, pr.created_at, NOW())
FROM ranked_active
WHERE pr.id = ranked_active.id
  AND ranked_active.rn > 1;

WITH no_active AS (
  SELECT profile_id
  FROM profile_revisions
  GROUP BY profile_id
  HAVING SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) = 0
),
ranked AS (
  SELECT
    pr.id,
    pr.profile_id,
    row_number() OVER (
      PARTITION BY pr.profile_id
      ORDER BY COALESCE(pr.created_at, NOW()) DESC, pr.id DESC
    ) AS rn
  FROM profile_revisions pr
  JOIN no_active na ON na.profile_id = pr.profile_id
)
UPDATE profile_revisions pr
SET
  status = 'active',
  activated_at = COALESCE(pr.activated_at, pr.created_at, NOW()),
  deprecated_at = NULL
FROM ranked
WHERE pr.id = ranked.id
  AND ranked.rn = 1;

UPDATE profile_revisions
SET
  activated_at = COALESCE(activated_at, created_at, NOW()),
  deprecated_at = NULL
WHERE status = 'active';

-- Ensure a single active template revision per template
WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY template_id
      ORDER BY COALESCE(activated_at, created_at, NOW()) DESC, id DESC
    ) AS rn
  FROM template_revisions
  WHERE status = 'active'
)
UPDATE template_revisions tr
SET
  status = 'deprecated',
  activated_at = NULL,
  deprecated_at = COALESCE(tr.deprecated_at, tr.created_at, NOW())
FROM ranked_active
WHERE tr.id = ranked_active.id
  AND ranked_active.rn > 1;

WITH no_active AS (
  SELECT template_id
  FROM template_revisions
  GROUP BY template_id
  HAVING SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) = 0
),
ranked AS (
  SELECT
    tr.id,
    tr.template_id,
    row_number() OVER (
      PARTITION BY tr.template_id
      ORDER BY COALESCE(tr.created_at, NOW()) DESC, tr.id DESC
    ) AS rn
  FROM template_revisions tr
  JOIN no_active na ON na.template_id = tr.template_id
)
UPDATE template_revisions tr
SET
  status = 'active',
  activated_at = COALESCE(tr.activated_at, tr.created_at, NOW()),
  deprecated_at = NULL
FROM ranked
WHERE tr.id = ranked.id
  AND ranked.rn = 1;

UPDATE template_revisions
SET
  activated_at = COALESCE(activated_at, created_at, NOW()),
  deprecated_at = NULL
WHERE status = 'active';

-- Ensure parent profile/template rows exist and active revision pointers are populated
INSERT INTO profiles (id, label, active_revision_id)
SELECT
  source.profile_id,
  source.profile_id,
  source.active_revision_id
FROM (
  SELECT
    pr.profile_id,
    (
      SELECT pr2.id
      FROM profile_revisions pr2
      WHERE pr2.profile_id = pr.profile_id
        AND pr2.status = 'active'
      ORDER BY pr2.activated_at DESC NULLS LAST, pr2.created_at DESC
      LIMIT 1
    ) AS active_revision_id
  FROM profile_revisions pr
  GROUP BY pr.profile_id
) AS source
ON CONFLICT (id) DO UPDATE
SET active_revision_id = COALESCE(EXCLUDED.active_revision_id, profiles.active_revision_id);

INSERT INTO templates (id, label, active_revision_id)
SELECT
  source.template_id,
  source.template_id,
  source.active_revision_id
FROM (
  SELECT
    tr.template_id,
    (
      SELECT tr2.id
      FROM template_revisions tr2
      WHERE tr2.template_id = tr.template_id
        AND tr2.status = 'active'
      ORDER BY tr2.activated_at DESC NULLS LAST, tr2.created_at DESC
      LIMIT 1
    ) AS active_revision_id
  FROM template_revisions tr
  GROUP BY tr.template_id
) AS source
ON CONFLICT (id) DO UPDATE
SET active_revision_id = COALESCE(EXCLUDED.active_revision_id, templates.active_revision_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_revisions_profile_version
  ON profile_revisions (profile_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_revisions_single_active
  ON profile_revisions (profile_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_revisions_template_version
  ON template_revisions (template_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_revisions_single_active
  ON template_revisions (template_id)
  WHERE status = 'active';

