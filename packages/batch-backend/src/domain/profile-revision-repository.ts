import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { FoundationalProfile } from '../application/foundational-profile.js';
import { withPgClient } from '../infrastructure/db.js';
import type {
  ProfileRevisionListResult,
  ProfileRevisionRecord,
  ProfileRevisionSource,
  RevisionStatus,
} from './profile-revision-model.js';

interface ProfileRevisionRow {
  id: string;
  profile_id: string;
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
}

export interface InsertProfileRevisionParams {
  id?: string;
  profileId: string;
  content: string;
  structuredContent?: FoundationalProfile | null;
  contentHash: string;
  source?: ProfileRevisionSource;
  status?: RevisionStatus;
  createdBy?: string | null;
  restoredFromRevisionId?: string | null;
}

export interface ListProfileRevisionsParams {
  profileId: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

const MAX_PAGE_LIMIT = 500;

const SELECT_COLUMNS = `
  id,
  profile_id,
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
  restored_from_revision_id
`;

export async function insertProfileRevision(
  params: InsertProfileRevisionParams,
): Promise<ProfileRevisionRecord> {
  const id = params.id ?? randomUUID();
  const status = params.status ?? 'active';

  const row = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      // Serialize revision versioning/activation per profile to avoid write races.
      await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [params.profileId]);

      if (status === 'active') {
        await client.query(
          `
          UPDATE profile_revisions
          SET
            status = 'deprecated',
            deprecated_at = COALESCE(deprecated_at, NOW()),
            activated_at = NULL
          WHERE profile_id = $1 AND status = 'active'
          `,
          [params.profileId],
        );
      }

      const result = await client.query(
        `
        WITH next_version AS (
          SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
          FROM profile_revisions
          WHERE profile_id = $2
        )
        INSERT INTO profile_revisions (
          id,
          profile_id,
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
          restored_from_revision_id
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
          $9
        FROM next_version
        RETURNING ${SELECT_COLUMNS}
        `,
        [
          id,
          params.profileId,
          params.content,
          JSON.stringify(params.structuredContent ?? null),
          params.contentHash,
          params.source ?? 'update',
          status,
          params.createdBy ?? null,
          params.restoredFromRevisionId ?? null,
        ],
      );

      if (status === 'active') {
        await client.query(
          'UPDATE profiles SET active_revision_id = $2, updated_at = NOW() WHERE id = $1',
          [params.profileId, id],
        );
      }

      await client.query('COMMIT');
      return result.rows[0] as ProfileRevisionRow;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return mapRow(row);
}

export async function listProfileRevisions(
  params: ListProfileRevisionsParams,
): Promise<ProfileRevisionListResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order === 'asc' ? 'asc' : 'desc';

  const { rows, total } = await withPgClient(async (client: PoolClient) => {
    const countResult = await client.query(
      'SELECT COUNT(*)::int AS total FROM profile_revisions WHERE profile_id = $1',
      [params.profileId],
    );
    const sortDirection = order === 'asc' ? 'ASC' : 'DESC';
    const dataResult = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM profile_revisions
      WHERE profile_id = $1
      ORDER BY created_at ${sortDirection}
      LIMIT $2 OFFSET $3
      `,
      [params.profileId, limit, offset],
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
  profileId: string,
  revisionId: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM profile_revisions
      WHERE profile_id = $1 AND id = $2
      `,
      [profileId, revisionId],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function getLatestProfileRevision(
  profileId: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM profile_revisions
      WHERE profile_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [profileId],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function getActiveProfileRevision(
  profileId: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM profile_revisions
      WHERE profile_id = $1 AND status = 'active'
      ORDER BY activated_at DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [profileId],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function listProfileIdsWithActiveRevision(
  profileIds: readonly string[],
): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set<string>();

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<{ profile_id: string }>(
      `
      SELECT DISTINCT profile_id
      FROM profile_revisions
      WHERE profile_id = ANY($1::text[]) AND status = 'active'
      `,
      [profileIds],
    );
    return result.rows;
  });

  return new Set(rows.map((row) => row.profile_id));
}

export async function activateProfileRevision(
  profileId: string,
  revisionId: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [profileId]);
      const existsResult = await client.query(
        'SELECT 1 FROM profile_revisions WHERE profile_id = $1 AND id = $2',
        [profileId, revisionId],
      );
      if ((existsResult.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `
        UPDATE profile_revisions
        SET
          status = 'deprecated',
          deprecated_at = COALESCE(deprecated_at, NOW()),
          activated_at = NULL
        WHERE profile_id = $1 AND id <> $2 AND status = 'active'
        `,
        [profileId, revisionId],
      );

      const result = await client.query(
        `
        UPDATE profile_revisions
        SET
          status = 'active',
          activated_at = NOW(),
          deprecated_at = NULL
        WHERE profile_id = $1 AND id = $2
        RETURNING ${SELECT_COLUMNS}
        `,
        [profileId, revisionId],
      );

      await client.query(
        'UPDATE profiles SET active_revision_id = $2, updated_at = NOW() WHERE id = $1',
        [profileId, revisionId],
      );

      await client.query('COMMIT');
      return result.rows[0] as ProfileRevisionRow | undefined;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return row ? mapRow(row) : null;
}

export async function deprecateActiveProfileRevision(profileId: string): Promise<number> {
  const updated = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [profileId]);
      const result = await client.query(
        `
        UPDATE profile_revisions
        SET
          status = 'deprecated',
          deprecated_at = COALESCE(deprecated_at, NOW()),
          activated_at = NULL
        WHERE profile_id = $1 AND status = 'active'
        `,
        [profileId],
      );
      await client.query(
        'UPDATE profiles SET active_revision_id = NULL, updated_at = NOW() WHERE id = $1',
        [profileId],
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
  profileId: string,
  contentHash: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM profile_revisions
      WHERE profile_id = $1 AND content_hash = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [profileId, contentHash],
    );
    return result.rows[0] as ProfileRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

function mapRow(row: ProfileRevisionRow): ProfileRevisionRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
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
  };
}
