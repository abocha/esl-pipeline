import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type {
  TemplateRevisionListResult,
  TemplateRevisionRecord,
  TemplateRevisionSource,
  TemplateRevisionStatus,
} from './template-revision-model.js';

interface TemplateRevisionRow {
  id: string;
  template_id: string;
  content: string;
  content_hash: string;
  source: TemplateRevisionSource;
  status: TemplateRevisionStatus;
  version_number: number;
  version_label: string;
  activated_at: Date | null;
  deprecated_at: Date | null;
  created_at: Date;
  created_by: string | null;
  restored_from_revision_id: string | null;
}

export interface InsertTemplateRevisionParams {
  id?: string;
  templateId: string;
  content: string;
  contentHash: string;
  source?: TemplateRevisionSource;
  status?: TemplateRevisionStatus;
  createdBy?: string | null;
  restoredFromRevisionId?: string | null;
}

export interface ListTemplateRevisionsParams {
  templateId: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

const MAX_PAGE_LIMIT = 500;

const SELECT_COLUMNS = `
  id,
  template_id,
  content,
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

export async function insertTemplateRevision(
  params: InsertTemplateRevisionParams,
): Promise<TemplateRevisionRecord> {
  const id = params.id ?? randomUUID();
  const status = params.status ?? 'active';

  const row = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `
        WITH next_version AS (
          SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
          FROM template_revisions
          WHERE template_id = $2
        )
        INSERT INTO template_revisions (
          id,
          template_id,
          content,
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
          next_version.version_number,
          CONCAT('v', next_version.version_number::text),
          CASE WHEN $6 = 'active' THEN NOW() ELSE NULL END,
          CASE WHEN $6 = 'deprecated' THEN NOW() ELSE NULL END,
          NOW(),
          $7,
          $8
        FROM next_version
        RETURNING ${SELECT_COLUMNS}
        `,
        [
          id,
          params.templateId,
          params.content,
          params.contentHash,
          params.source ?? 'update',
          status,
          params.createdBy ?? null,
          params.restoredFromRevisionId ?? null,
        ],
      );

      const inserted = result.rows[0] as TemplateRevisionRow;

      if (status === 'active') {
        await client.query(
          `
          UPDATE template_revisions
          SET
            status = 'deprecated',
            deprecated_at = COALESCE(deprecated_at, NOW()),
            activated_at = NULL
          WHERE template_id = $1 AND id <> $2 AND status = 'active'
          `,
          [params.templateId, inserted.id],
        );
      }

      await client.query('COMMIT');
      return inserted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return mapRow(row);
}

export async function listTemplateRevisions(
  params: ListTemplateRevisionsParams,
): Promise<TemplateRevisionListResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order === 'asc' ? 'asc' : 'desc';

  const { rows, total } = await withPgClient(async (client: PoolClient) => {
    const countResult = await client.query(
      'SELECT COUNT(*)::int AS total FROM template_revisions WHERE template_id = $1',
      [params.templateId],
    );
    const sortDirection = order === 'asc' ? 'ASC' : 'DESC';
    const dataResult = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM template_revisions
      WHERE template_id = $1
      ORDER BY created_at ${sortDirection}
      LIMIT $2 OFFSET $3
      `,
      [params.templateId, limit, offset],
    );

    return {
      rows: dataResult.rows as TemplateRevisionRow[],
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

export async function getTemplateRevisionById(
  templateId: string,
  revisionId: string,
): Promise<TemplateRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM template_revisions
      WHERE template_id = $1 AND id = $2
      `,
      [templateId, revisionId],
    );
    return result.rows[0] as TemplateRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function getLatestTemplateRevision(
  templateId: string,
): Promise<TemplateRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM template_revisions
      WHERE template_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [templateId],
    );
    return result.rows[0] as TemplateRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function getActiveTemplateRevision(
  templateId: string,
): Promise<TemplateRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM template_revisions
      WHERE template_id = $1 AND status = 'active'
      ORDER BY activated_at DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [templateId],
    );
    return result.rows[0] as TemplateRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function listTemplateIdsWithActiveRevision(
  templateIds: readonly string[],
): Promise<Set<string>> {
  if (templateIds.length === 0) return new Set<string>();

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<{ template_id: string }>(
      `
      SELECT DISTINCT template_id
      FROM template_revisions
      WHERE template_id = ANY($1::text[]) AND status = 'active'
      `,
      [templateIds],
    );
    return result.rows;
  });

  return new Set(rows.map((row) => row.template_id));
}

export async function activateTemplateRevision(
  templateId: string,
  revisionId: string,
): Promise<TemplateRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const existsResult = await client.query(
        'SELECT 1 FROM template_revisions WHERE template_id = $1 AND id = $2',
        [templateId, revisionId],
      );
      if ((existsResult.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `
        UPDATE template_revisions
        SET
          status = 'deprecated',
          deprecated_at = COALESCE(deprecated_at, NOW()),
          activated_at = NULL
        WHERE template_id = $1 AND id <> $2 AND status = 'active'
        `,
        [templateId, revisionId],
      );

      const result = await client.query(
        `
        UPDATE template_revisions
        SET
          status = 'active',
          activated_at = NOW(),
          deprecated_at = NULL
        WHERE template_id = $1 AND id = $2
        RETURNING ${SELECT_COLUMNS}
        `,
        [templateId, revisionId],
      );

      await client.query('COMMIT');
      return result.rows[0] as TemplateRevisionRow | undefined;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return row ? mapRow(row) : null;
}

export async function deprecateActiveTemplateRevision(templateId: string): Promise<number> {
  const updated = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE template_revisions
      SET
        status = 'deprecated',
        deprecated_at = COALESCE(deprecated_at, NOW()),
        activated_at = NULL
      WHERE template_id = $1 AND status = 'active'
      `,
      [templateId],
    );
    return result.rowCount ?? 0;
  });

  return updated;
}

export async function getLatestTemplateRevisionByHash(
  templateId: string,
  contentHash: string,
): Promise<TemplateRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM template_revisions
      WHERE template_id = $1 AND content_hash = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [templateId, contentHash],
    );
    return result.rows[0] as TemplateRevisionRow | undefined;
  });

  return row ? mapRow(row) : null;
}

function mapRow(row: TemplateRevisionRow): TemplateRevisionRecord {
  return {
    id: row.id,
    templateId: row.template_id,
    content: row.content,
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
