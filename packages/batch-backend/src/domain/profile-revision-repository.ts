import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { FoundationalProfile } from '../application/foundational-profile.js';
import { withPgClient } from '../infrastructure/db.js';
import { suppressRemovedProfileFacts } from './profile-removal-suppression.js';
import type {
  ProfileRevisionListResult,
  ProfileRevisionRecord,
  ProfileRevisionSource,
  RevisionStatus,
} from './profile-revision-model.js';
import {
  assertProfileHead,
  lockProfileHead,
  ProfileWriteConflictError,
} from './profile-write-authority.js';
import { setStudentActivityActor } from './student-activity-recording.js';

interface ProfileRevisionRow {
  id: string;
  student_id: string;
  content: string;
  structured_content: FoundationalProfile | null;
  content_hash: string;
  source: ProfileRevisionSource;
  status: RevisionStatus;
  version_number: number;
  version_label: string;
  activated_at: Date | null;
  deprecated_at: Date | null;
  created_at: Date;
  created_by: string | null;
  restored_from_revision_id: string | null;
  legacy_version_label: string | null;
  base_active_revision_id: string | null;
  base_active_revision_known: boolean;
}

export interface InsertProfileRevisionParams {
  expectedActiveRevisionId?: string | null;
  id?: string;
  studentId: string;
  content: string;
  structuredContent?: FoundationalProfile | null;
  contentHash: string;
  source?: ProfileRevisionSource;
  status?: RevisionStatus;
  createdBy?: string | null;
  restoredFromRevisionId?: string | null;
}

export interface ListProfileRevisionsParams {
  studentId: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

const MAX_PAGE_LIMIT = 500;

const SELECT_COLUMNS = `
  id,
  student_id,
  content,
  structured_content,
  content_hash,
  source,
  status,
  version_number,
  version_label,
  activated_at,
  deprecated_at,
  created_at,
  created_by,
  restored_from_revision_id,
  legacy_version_label,
  base_active_revision_id,
  base_active_revision_known
`;

export async function checkProfileRevisionHead(
  studentId: string,
  expectedActiveRevisionId: string | null | undefined,
): Promise<void> {
  await withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const head = await lockProfileHead(client, studentId);
      assertProfileHead(expectedActiveRevisionId, head?.id ?? null);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function insertProfileRevision(
  params: InsertProfileRevisionParams,
): Promise<ProfileRevisionRecord> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const revision = await insertProfileRevisionWithClient(client, params);
      await client.query('COMMIT');
      return revision;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/** Owns no transaction; callers compose revision/provenance atomically. */
export async function insertProfileRevisionWithClient(
  client: PoolClient,
  params: InsertProfileRevisionParams,
): Promise<ProfileRevisionRecord> {
  const id = params.id ?? randomUUID();
  const status = params.status ?? 'active';
  await setStudentActivityActor(client, params.createdBy);
  const head = await lockProfileHead(client, params.studentId);
  assertProfileHead(params.expectedActiveRevisionId, head?.id ?? null);
  if (status === 'active') {
    await suppressRemovedProfileFacts(
      client,
      params.studentId,
      head?.structured_content ?? null,
      params.structuredContent ?? null,
    );
    await client.query(
      `
          UPDATE student_profile_revisions
          SET
            status = 'deprecated',
            deprecated_at = COALESCE(deprecated_at, NOW())
          WHERE student_id = $1 AND status = 'active'
          `,
      [params.studentId],
    );
  }

  const result = await client.query(
    `
        WITH next_version AS (
          SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
          FROM student_profile_revisions
          WHERE student_id = $2
        )
        INSERT INTO student_profile_revisions (
          id,
          student_id,
          content,
          structured_content,
          content_hash,
          source,
          status,
          version_number,
          version_label,
          activated_at,
          deprecated_at,
          created_at,
          created_by,
          restored_from_revision_id,
          base_active_revision_id,
          base_active_revision_known
        )
        SELECT
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          next_version.version_number,
          CONCAT('v', next_version.version_number::text),
          CASE WHEN $7 = 'active' THEN NOW() ELSE NULL END,
          CASE WHEN $7 = 'deprecated' THEN NOW() ELSE NULL END,
          NOW(),
          $8,
          $9,
          $10,
          true
        FROM next_version
        RETURNING ${SELECT_COLUMNS}
        `,
    [
      id,
      params.studentId,
      params.content,
      JSON.stringify(params.structuredContent ?? null),
      params.contentHash,
      params.source ?? 'update',
      status,
      params.createdBy ?? null,
      params.restoredFromRevisionId ?? null,
      params.expectedActiveRevisionId,
    ],
  );

  return mapRow(result.rows[0] as ProfileRevisionRow);
}

export async function listProfileRevisions(
  params: ListProfileRevisionsParams,
): Promise<ProfileRevisionListResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order === 'asc' ? 'asc' : 'desc';

  const { rows, total } = await withPgClient(async (client: PoolClient) => {
    const countResult = await client.query(
      'SELECT COUNT(*)::int AS total FROM student_profile_revisions WHERE student_id = $1',
      [params.studentId],
    );
    const sortDirection = order === 'asc' ? 'ASC' : 'DESC';
    const dataResult = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM student_profile_revisions
      WHERE student_id = $1
      ORDER BY created_at ${sortDirection}
      LIMIT $2 OFFSET $3
      `,
      [params.studentId, limit, offset],
    );

    return {
      rows: dataResult.rows as ProfileRevisionRow[],
      total: countResult.rows[0]?.total ?? 0,
    };
  });

  return {
    items: rows.map((row) => mapRow(row)),
    total,
    limit,
    offset,
    order,
  };
}

export async function getProfileRevisionById(
  studentId: string,
  revisionId: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM student_profile_revisions
      WHERE student_id = $1 AND id = $2
      `,
      [studentId, revisionId],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function getLatestProfileRevision(
  studentId: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM student_profile_revisions
      WHERE student_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [studentId],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

/** Resolve only a concrete revision recorded in an authorized assignment.
 * Legacy IDs are immutable provenance; ordinary revision routes use getById.
 */
export async function getRecordedProfileRevision(
  studentId: string,
  revisionId: string,
  contentHash: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client) => {
    const result = await client.query(
      `SELECT ${SELECT_COLUMNS} FROM student_profile_revisions
       WHERE student_id = $1 AND (id = $2 OR legacy_revision_id = $2)
         AND content_hash = $3`,
      [studentId, revisionId, contentHash],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });
  return row ? mapRow(row) : null;
}

export async function getActiveProfileRevision(
  studentId: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM student_profile_revisions
      WHERE student_id = $1 AND status = 'active'
      ORDER BY activated_at DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [studentId],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function listStudentIdsWithActiveProfileRevision(
  studentIds: readonly string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set<string>();

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<{ student_id: string }>(
      `
      SELECT DISTINCT student_id
      FROM student_profile_revisions
      WHERE student_id = ANY($1::uuid[]) AND status = 'active'
      `,
      [studentIds],
    );
    return result.rows;
  });

  return new Set(rows.map((row) => row.student_id));
}

export async function activateProfileRevision(
  studentId: string,
  revisionId: string,
  actorUserId?: string | null,
  expectedActiveRevisionId?: string | null,
  afterActivate?: (client: PoolClient, revision: ProfileRevisionRecord) => Promise<void>,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      await setStudentActivityActor(client, actorUserId);
      const head = await lockProfileHead(client, studentId);
      assertProfileHead(expectedActiveRevisionId, head?.id ?? null);
      const draft = await client.query<{
        status: string;
        base_active_revision_id: string | null;
        base_active_revision_known: boolean;
        structured_content: unknown;
      }>(
        'SELECT status,base_active_revision_id,base_active_revision_known,structured_content FROM student_profile_revisions WHERE student_id=$1 AND id=$2',
        [studentId, revisionId],
      );
      if (
        draft.rows[0]?.status === 'draft' &&
        (!draft.rows[0].base_active_revision_known ||
          draft.rows[0].base_active_revision_id !== (head?.id ?? null))
      )
        throw new ProfileWriteConflictError('profile_revision_conflict', head?.id ?? null);
      const existsResult = await client.query(
        'SELECT 1 FROM student_profile_revisions WHERE student_id = $1 AND id = $2',
        [studentId, revisionId],
      );
      if ((existsResult.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      await suppressRemovedProfileFacts(
        client,
        studentId,
        head?.structured_content ?? null,
        draft.rows[0]?.structured_content ?? null,
      );
      await client.query(
        `
        UPDATE student_profile_revisions
        SET
          status = 'deprecated',
          deprecated_at = COALESCE(deprecated_at, NOW())
        WHERE student_id = $1 AND id <> $2 AND status = 'active'
        `,
        [studentId, revisionId],
      );

      const result = await client.query(
        `
        UPDATE student_profile_revisions
        SET
          status = 'active',
          activated_at = NOW(),
          deprecated_at = NULL
        WHERE student_id = $1 AND id = $2
        RETURNING ${SELECT_COLUMNS}
        `,
        [studentId, revisionId],
      );

      if (result.rows[0] && afterActivate)
        await afterActivate(client, mapRow(result.rows[0] as ProfileRevisionRow));
      await client.query('COMMIT');
      return result.rows[0] as ProfileRevisionRow | undefined;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return row ? mapRow(row) : null;
}

export async function deprecateActiveProfileRevision(
  studentId: string,
  expectedActiveRevisionId?: string | null,
): Promise<number> {
  const updated = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const head = await lockProfileHead(client, studentId);
      assertProfileHead(expectedActiveRevisionId, head?.id ?? null);
      await suppressRemovedProfileFacts(client, studentId, head?.structured_content ?? null, null);
      const result = await client.query(
        `
        UPDATE student_profile_revisions
        SET
          status = 'deprecated',
          deprecated_at = COALESCE(deprecated_at, NOW())
        WHERE student_id = $1 AND status = 'active'
        `,
        [studentId],
      );
      await client.query('COMMIT');
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return updated;
}

export async function getLatestProfileRevisionByHash(
  studentId: string,
  contentHash: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM student_profile_revisions
      WHERE student_id = $1 AND content_hash = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [studentId, contentHash],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

function mapRow(row: ProfileRevisionRow): ProfileRevisionRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    content: row.content,
    structuredContent: row.structured_content ?? null,
    contentHash: row.content_hash,
    source: row.source,
    status: row.status,
    versionNumber: row.version_number,
    versionLabel: row.version_label,
    activatedAt: row.activated_at ?? null,
    deprecatedAt: row.deprecated_at ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
    restoredFromRevisionId: row.restored_from_revision_id ?? null,
    legacyVersionLabel: row.legacy_version_label ?? null,
    baseActiveRevisionId: row.base_active_revision_id ?? null,
    baseActiveRevisionKnown: row.base_active_revision_known ?? false,
  };
}
