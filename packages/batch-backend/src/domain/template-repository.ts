import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type { TemplateListResult, TemplateRecord } from './template-model.js';

interface TemplateRow {
  id: string;
  label: string;
  active_revision_id: string | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertTemplateParams {
  id: string;
  label: string;
  activeRevisionId?: string | null;
}

export interface ListTemplatesParams {
  search?: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

const MAX_PAGE_LIMIT = 500;

export async function upsertTemplate(params: UpsertTemplateParams): Promise<TemplateRecord> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO templates (id, label, active_revision_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
      SET
        label = EXCLUDED.label,
        active_revision_id = COALESCE(EXCLUDED.active_revision_id, templates.active_revision_id)
      RETURNING
        id,
        label,
        active_revision_id,
        is_default,
        created_at,
        updated_at
      `,
      [params.id, params.label, params.activeRevisionId ?? null],
    );
    return result.rows[0] as TemplateRow;
  });

  return mapRow(row);
}

export async function setTemplateActiveRevision(
  templateId: string,
  revisionId: string | null,
): Promise<TemplateRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE templates
      SET
        active_revision_id = $2,
        is_default = CASE WHEN $2 IS NULL THEN FALSE ELSE is_default END
      WHERE id = $1
      RETURNING
        id,
        label,
        active_revision_id,
        is_default,
        created_at,
        updated_at
      `,
      [templateId, revisionId],
    );
    return result.rows[0] as TemplateRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function getTemplateById(id: string): Promise<TemplateRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        label,
        active_revision_id,
        is_default,
        created_at,
        updated_at
      FROM templates
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0] as TemplateRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function listTemplates(params: ListTemplatesParams = {}): Promise<TemplateListResult> {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order === 'desc' ? 'desc' : 'asc';
  const values: (string | number)[] = [];
  const filters: string[] = [];
  let index = 1;

  if (params.search?.trim()) {
    const search = `%${params.search.trim()}%`;
    values.push(search);
    filters.push(`(id ILIKE $${index} OR label ILIKE $${index})`);
    index += 1;
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  const { rows, total } = await withPgClient(async (client: PoolClient) => {
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM templates ${whereClause}`,
      values,
    );
    const dataResult = await client.query(
      `
      SELECT
        id,
        label,
        active_revision_id,
        is_default,
        created_at,
        updated_at
      FROM templates
      ${whereClause}
      ORDER BY label ${orderDirection}, id ${orderDirection}
      LIMIT $${index} OFFSET $${index + 1}
      `,
      [...values, limit, offset],
    );
    return {
      rows: dataResult.rows as TemplateRow[],
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

export async function deleteTemplateById(id: string): Promise<boolean> {
  const deleted = await withPgClient(async (client: PoolClient) => {
    const result = await client.query('DELETE FROM templates WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  });

  return deleted;
}

export async function setDefaultTemplate(templateId: string): Promise<TemplateRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const currentResult = await client.query(
        `
        SELECT
          id,
          label,
          active_revision_id,
          is_default,
          created_at,
          updated_at
        FROM templates
        WHERE id = $1 AND active_revision_id IS NOT NULL
        FOR UPDATE
        `,
        [templateId],
      );
      const current = currentResult.rows[0] as TemplateRow | undefined;
      if (!current) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query('UPDATE templates SET is_default = FALSE WHERE is_default = TRUE');
      const updatedResult = await client.query(
        `
        UPDATE templates
        SET is_default = TRUE
        WHERE id = $1
        RETURNING
          id,
          label,
          active_revision_id,
          is_default,
          created_at,
          updated_at
        `,
        [templateId],
      );
      await client.query('COMMIT');
      return updatedResult.rows[0] as TemplateRow;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return row ? mapRow(row) : null;
}

function mapRow(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    label: row.label,
    activeRevisionId: row.active_revision_id ?? null,
    isDefault: row.is_default ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
