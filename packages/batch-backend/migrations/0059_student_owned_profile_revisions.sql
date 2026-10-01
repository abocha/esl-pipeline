-- ABO-12: direct runtime cutover. Original rows remain frozen solely for
-- provenance and operator reconciliation; there is no legacy runtime lookup.
ALTER TABLE profiles RENAME TO legacy_profiles;
ALTER TABLE profile_revisions RENAME TO legacy_profile_revisions;
ALTER TABLE student_profile_bindings RENAME TO legacy_student_profile_bindings;

CREATE TABLE student_profile_revisions (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  content text NOT NULL,
  structured_content jsonb,
  content_hash text NOT NULL,
  source text NOT NULL CHECK (source IN ('create', 'update', 'restore',
    'starter_profile_form', 'candidate_promotion', 'legacy_normalization',
    'lesson_population', 'profile_revision_refresh')),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  version_number integer NOT NULL CHECK (version_number > 0),
  version_label text NOT NULL,
  activated_at timestamptz,
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  restored_from_revision_id uuid,
  legacy_profile_id text,
  legacy_revision_id uuid,
  legacy_version_label text,
  UNIQUE (student_id, id),
  UNIQUE (student_id, version_number),
  UNIQUE (student_id, legacy_revision_id),
  CONSTRAINT student_profile_revision_restore_owner_fkey
    FOREIGN KEY (student_id, restored_from_revision_id)
    REFERENCES student_profile_revisions(student_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX student_profile_revisions_single_active
  ON student_profile_revisions(student_id) WHERE status = 'active';
CREATE INDEX student_profile_revisions_student_created
  ON student_profile_revisions(student_id, created_at DESC);
CREATE INDEX student_profile_revisions_student_hash
  ON student_profile_revisions(student_id, content_hash);

-- A temporary map is derived only from explicit student references. It is
-- discarded at commit, and never inferred from creator identity.
CREATE TEMP TABLE abo12_profile_owners ON COMMIT DROP AS
  SELECT id AS student_id, profile_id FROM students WHERE profile_id IS NOT NULL
  UNION SELECT student_id, profile_id FROM legacy_student_profile_bindings
  UNION SELECT student_id, resolved_profile_id FROM prompt_packages
    WHERE student_id IS NOT NULL AND resolved_profile_id IS NOT NULL
  UNION SELECT student_id, selected_profile_id FROM assignment_sessions
    WHERE selected_profile_id IS NOT NULL
  UNION SELECT p.student_id, r.profile_id FROM prompt_packages p
    JOIN legacy_profile_revisions r ON r.id = p.resolved_profile_revision_id
    WHERE p.student_id IS NOT NULL
  UNION SELECT a.student_id, r.profile_id FROM assignment_sessions a
    JOIN legacy_profile_revisions r ON r.id = a.selected_profile_revision_id
  UNION SELECT a.student_id, r.profile_id FROM assignment_sessions a
    JOIN legacy_profile_revisions r ON r.id::text =
      a.confirmed_snapshot->'context'->>'profileRevisionId'
  UNION SELECT student_id, profile_id FROM profile_initial_enrichment_operations
  UNION SELECT c.student_id, r.profile_id FROM student_profile_candidates c
    JOIN legacy_profile_revisions r ON r.id = c.promoted_revision_id
  UNION SELECT c.student_id, r.profile_id FROM student_profile_candidate_draft_revisions l
    JOIN student_profile_candidates c ON c.id = l.candidate_id
    JOIN legacy_profile_revisions r ON r.id = l.revision_id;

CREATE TEMP TABLE abo12_revision_map ON COMMIT DROP AS
SELECT o.student_id, r.id AS legacy_revision_id,
       md5('abo12:' || o.student_id::text || ':' || r.id::text)::uuid AS id,
       row_number() OVER (PARTITION BY o.student_id
         ORDER BY r.created_at, r.profile_id, r.version_number, r.id)::integer AS version_number
FROM abo12_profile_owners o
JOIN legacy_profile_revisions r ON r.profile_id = o.profile_id
JOIN students s ON s.id = o.student_id;

INSERT INTO student_profile_revisions
  (id, student_id, content, structured_content, content_hash, source, status,
   version_number, version_label, activated_at, deprecated_at, created_at,
   created_by, legacy_profile_id, legacy_revision_id, legacy_version_label)
SELECT m.id, m.student_id, r.content, r.structured_content, r.content_hash, r.source,
       CASE WHEN r.status = 'active' AND r.profile_id = s.profile_id THEN 'active'
            WHEN r.status = 'active' THEN 'deprecated' ELSE r.status END,
       m.version_number, 'v' || m.version_number::text,
       r.activated_at, r.deprecated_at, r.created_at, r.created_by, r.profile_id, r.id, r.version_label
FROM abo12_revision_map m JOIN legacy_profile_revisions r ON r.id = m.legacy_revision_id
JOIN students s ON s.id = m.student_id;

UPDATE student_profile_revisions n
SET restored_from_revision_id = parent.id
FROM legacy_profile_revisions r, abo12_revision_map parent
WHERE r.id = n.legacy_revision_id AND parent.student_id = n.student_id
  AND parent.legacy_revision_id = r.restored_from_revision_id;

-- Candidate links are current student-owned workflow state, unlike immutable
-- prompt-package snapshots (which retain their original IDs/hash/version).
ALTER TABLE student_profile_candidate_draft_revisions
  DROP CONSTRAINT student_profile_candidate_draft_revisions_revision_id_fkey;
UPDATE student_profile_candidate_draft_revisions l SET revision_id = m.id
FROM student_profile_candidates c, abo12_revision_map m
WHERE c.id = l.candidate_id AND m.student_id = c.student_id
  AND m.legacy_revision_id = l.revision_id;
-- Do not discard an unattributable link: abort so an operator can reconcile it.
ALTER TABLE student_profile_candidate_draft_revisions
  ADD FOREIGN KEY (revision_id) REFERENCES student_profile_revisions(id) ON DELETE RESTRICT;
ALTER TABLE student_profile_candidates ADD UNIQUE (student_id, id);
ALTER TABLE student_profile_candidate_draft_revisions ADD COLUMN student_id uuid;
UPDATE student_profile_candidate_draft_revisions l SET student_id = c.student_id
FROM student_profile_candidates c WHERE c.id = l.candidate_id;
ALTER TABLE student_profile_candidate_draft_revisions
  ALTER COLUMN student_id SET NOT NULL,
  ADD FOREIGN KEY (student_id, candidate_id) REFERENCES student_profile_candidates(student_id, id) ON DELETE CASCADE,
  ADD FOREIGN KEY (student_id, revision_id) REFERENCES student_profile_revisions(student_id, id) ON DELETE RESTRICT;

ALTER TABLE student_profile_candidates DROP CONSTRAINT student_profile_candidates_promoted_revision_id_fkey;
UPDATE student_profile_candidates c SET promoted_revision_id = m.id
FROM abo12_revision_map m WHERE m.student_id = c.student_id AND m.legacy_revision_id = c.promoted_revision_id;
ALTER TABLE student_profile_candidates ADD FOREIGN KEY (student_id, promoted_revision_id)
  REFERENCES student_profile_revisions(student_id, id) ON DELETE RESTRICT;

ALTER TABLE students
  ADD COLUMN profile_provenance text NOT NULL DEFAULT 'tutor_only'
    CHECK (profile_provenance IN ('unknown', 'tutor_only', 'evidence_enriched')),
  ADD COLUMN profile_initial_enrichment_completed_at timestamptz,
  ADD CHECK ((profile_provenance = 'evidence_enriched') =
    (profile_initial_enrichment_completed_at IS NOT NULL));
UPDATE students s SET profile_provenance = p.provenance,
  profile_initial_enrichment_completed_at = p.initial_enrichment_completed_at
FROM legacy_profiles p WHERE p.id = s.profile_id;

ALTER TABLE profile_initial_enrichment_operations
  DROP CONSTRAINT profile_initial_enrichment_operations_seed_revision_id_fkey,
  DROP CONSTRAINT profile_initial_enrichment_operations_result_revision_id_fkey;
UPDATE profile_initial_enrichment_operations op SET seed_revision_id = m.id
FROM abo12_revision_map m WHERE m.student_id = op.student_id AND m.legacy_revision_id = op.seed_revision_id;
UPDATE profile_initial_enrichment_operations op SET result_revision_id = m.id
FROM abo12_revision_map m WHERE m.student_id = op.student_id AND m.legacy_revision_id = op.result_revision_id;
ALTER TABLE profile_initial_enrichment_operations
  ADD FOREIGN KEY (student_id, seed_revision_id) REFERENCES student_profile_revisions(student_id, id) ON DELETE RESTRICT,
  ADD FOREIGN KEY (student_id, result_revision_id) REFERENCES student_profile_revisions(student_id, id) ON DELETE RESTRICT;
DROP INDEX profile_initial_enrichment_live_profile_idx;
DROP INDEX profile_initial_enrichment_success_profile_idx;
DROP INDEX profile_initial_enrichment_exact_source_idx;
CREATE UNIQUE INDEX profile_initial_enrichment_live_student_idx
  ON profile_initial_enrichment_operations(student_id)
  WHERE state IN ('waiting_evidence', 'queued', 'submitting', 'result_ready', 'uncertain');
-- Multiple historical successes and exact-source attempts can survive old
-- rebinding. Student provenance gates new work; do not delete that evidence.
CREATE INDEX profile_initial_enrichment_success_student_idx
  ON profile_initial_enrichment_operations(student_id) WHERE state = 'succeeded';
CREATE INDEX profile_initial_enrichment_exact_source_idx
  ON profile_initial_enrichment_operations(student_id, assignment_session_id, transcript_id, transcript_hash);
-- Original operation ownership is retained as historical metadata only.
ALTER TABLE profile_initial_enrichment_operations RENAME COLUMN profile_id TO legacy_profile_id;
ALTER TABLE profile_initial_enrichment_operations ALTER COLUMN legacy_profile_id DROP NOT NULL;

-- Session selection and confirmed JSON are historical evidence. Leave their
-- legacy IDs intact; new confirmations select only student-owned revisions.
-- Packages deliberately retain exact historical revision/hash/version fields.
ALTER TABLE assignment_sessions DROP CONSTRAINT assignment_sessions_selected_profile_revision_id_fkey;
ALTER TABLE students DROP COLUMN profile_id;

-- Freeze the retained archive against accidental writes, including old binaries.
CREATE FUNCTION reject_legacy_profile_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Legacy profile storage is frozen; reconcile ABO-12 before removal';
END;
$$;
CREATE TRIGGER freeze_legacy_profiles BEFORE INSERT OR UPDATE OR DELETE ON legacy_profiles
  FOR EACH ROW EXECUTE FUNCTION reject_legacy_profile_write();
CREATE TRIGGER freeze_legacy_profile_revisions BEFORE INSERT OR UPDATE OR DELETE ON legacy_profile_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_legacy_profile_write();
CREATE TRIGGER freeze_legacy_profile_bindings BEFORE INSERT OR UPDATE OR DELETE ON legacy_student_profile_bindings
  FOR EACH ROW EXECUTE FUNCTION reject_legacy_profile_write();
