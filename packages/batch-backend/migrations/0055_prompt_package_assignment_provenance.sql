ALTER TABLE prompt_packages
  ADD COLUMN assignment_session_id UUID REFERENCES assignment_sessions(id) ON DELETE RESTRICT;

-- Only direct, unique session references establish historical assignment provenance.
WITH session_links AS (
  SELECT id AS session_id, prompt_package_id AS package_id
  FROM assignment_sessions
  WHERE prompt_package_id IS NOT NULL
  UNION
  SELECT id AS session_id, (confirmed_snapshot #>> '{create,promptPackageId}')::uuid AS package_id
  FROM assignment_sessions
  WHERE confirmed_snapshot #>> '{create,promptPackageId}' IS NOT NULL
), unique_references AS (
  SELECT package_id, MIN(session_id::text)::uuid AS session_id
  FROM session_links
  GROUP BY package_id
  HAVING COUNT(*) = 1
)
UPDATE prompt_packages p
SET assignment_session_id = r.session_id
FROM unique_references r
WHERE p.id = r.package_id;
