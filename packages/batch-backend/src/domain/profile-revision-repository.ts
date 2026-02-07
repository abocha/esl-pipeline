import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type {
  ProfileRevisionListResult,
  ProfileRevisionRecord,
  ProfileRevisionSource,
} from './profile-revision-model.js';

interface ProfileRevisionRow {
  id: string;
  profile_id: string;
  content: string;
  content_hash: string;
  source: ProfileRevisionSource;
  created_at: Date;
  created_by: string | null;
  restored_from_revision_id: string | null;
}

export interface InsertProfileRevisionParams {
  id?: string;
  profileId: string;
  content: string;
  contentHash: string;
  source?: ProfileRevisionSource;
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

export async function insertProfileRevision(
  params: InsertProfileRevisionParams,
): Promise<ProfileRevisionRecord> {
  const id = params.id ?? randomUUID();
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO profile_revisions (
        id,
        profile_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
      RETURNING
        id,
        profile_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
      `,
      [
        id,
        params.profileId,
        params.content,
        params.contentHash,
        params.source ?? 'update',
        params.createdBy ?? null,
        params.restoredFromRevisionId ?? null,
      ],
    );
    return result.rows[0] as ProfileRevisionRow;
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
        id,
        profile_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
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
        id,
        profile_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
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
        id,
        profile_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
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

export async function getLatestProfileRevisionByHash(
  profileId: string,
  contentHash: string,
): Promise<ProfileRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        profile_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
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
    contentHash: row.content_hash,
    source: row.source,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
    restoredFromRevisionId: row.restored_from_revision_id ?? null,
  };
}
