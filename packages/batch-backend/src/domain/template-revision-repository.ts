import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type {
  TemplateRevisionListResult,
  TemplateRevisionRecord,
  TemplateRevisionSource,
} from './template-revision-model.js';

interface TemplateRevisionRow {
  id: string;
  template_id: string;
  content: string;
  content_hash: string;
  source: TemplateRevisionSource;
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

export async function insertTemplateRevision(
  params: InsertTemplateRevisionParams,
): Promise<TemplateRevisionRecord> {
  const id = params.id ?? randomUUID();
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO template_revisions (
        id,
        template_id,
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
        template_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
      `,
      [
        id,
        params.templateId,
        params.content,
        params.contentHash,
        params.source ?? 'update',
        params.createdBy ?? null,
        params.restoredFromRevisionId ?? null,
      ],
    );
    return result.rows[0] as TemplateRevisionRow;
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
        id,
        template_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
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
        id,
        template_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
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
        id,
        template_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
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

export async function getLatestTemplateRevisionByHash(
  templateId: string,
  contentHash: string,
): Promise<TemplateRevisionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        template_id,
        content,
        content_hash,
        source,
        created_at,
        created_by,
        restored_from_revision_id
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
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
    restoredFromRevisionId: row.restored_from_revision_id ?? null,
  };
}
