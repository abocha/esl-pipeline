import path from 'node:path';
import { withPgClient } from '../infrastructure/db.js';

export type StudentTimelineType =
  | 'recording_ingested'
  | 'transcript_ready'
  | 'prompt_package_created'
  | 'draft_saved'
  | 'job_awaiting_approval'
  | 'job_completed';

export interface StudentTimelineItem {
  type: StudentTimelineType;
  studentId: string;
  recordingId?: string | null;
  transcriptId?: string | null;
  promptPackageId?: string | null;
  draftId?: string | null;
  jobId?: string | null;
  status: string;
  createdAt: string;
  displayName: string;
  details?: Record<string, unknown>;
}

export interface StudentTimelineResponse {
  items: StudentTimelineItem[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface StudentTimelineParams {
  types?: StudentTimelineType[];
  statuses?: string[];
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

const MAX_PAGE_LIMIT = 500;

interface TimelineRow {
  type: StudentTimelineType;
  status: string;
  created_at: Date;
  recording_id: string | null;
  transcript_id: string | null;
  prompt_package_id: string | null;
  draft_id: string | null;
  job_id: string | null;
  source_path: string | null;
  storage_uri: string | null;
  error: string | null;
}

function deriveDisplayName(params: {
  fallbackId: string;
  sourcePath?: string | null;
  storageUri?: string | null;
}): string {
  const sourcePath = params.sourcePath?.trim() ?? '';
  const storageUri = params.storageUri?.trim() ?? '';
  const candidate = sourcePath || storageUri;
  if (!candidate) return params.fallbackId;
  const cleaned = candidate.split('?')[0]?.split('#')[0] ?? candidate;
  const base = path.basename(cleaned);
  return base && base !== '.' && base !== '/' ? base : params.fallbackId;
}

function normalizeTypeFilter(types?: StudentTimelineType[] | string): Set<StudentTimelineType> | null {
  if (!types) return null;
  const list = Array.isArray(types) ? types : String(types).split(',');
  const filtered = list
    .map((value) => value.trim())
    .map((value) => (value === 'job_approved' ? 'job_awaiting_approval' : value))
    .filter((value): value is StudentTimelineType => value.length > 0);
  return filtered.length > 0 ? new Set(filtered) : null;
}

function normalizeStatusFilter(statuses?: string[] | string): Set<string> | null {
  if (!statuses) return null;
  const list = Array.isArray(statuses) ? statuses : String(statuses).split(',');
  const filtered = list.map((value) => value.trim()).filter((value) => value.length > 0);
  return filtered.length > 0 ? new Set(filtered) : null;
}

const timelineQuery = `
  WITH timeline AS (
    SELECT 'recording_ingested'::text AS type,
           r.status::text AS status,
           r.created_at,
           r.id AS recording_id,
           NULL::uuid AS transcript_id,
           NULL::uuid AS prompt_package_id,
           NULL::uuid AS draft_id,
           NULL::uuid AS job_id,
           r.source_path,
           r.storage_uri,
           r.error
    FROM recordings r
    WHERE r.student_id = $1

    UNION ALL

    SELECT 'transcript_ready'::text AS type,
           'ready'::text AS status,
           t.created_at,
           t.recording_id,
           t.id AS transcript_id,
           NULL::uuid AS prompt_package_id,
           NULL::uuid AS draft_id,
           NULL::uuid AS job_id,
           r.source_path,
           r.storage_uri,
           NULL::text AS error
    FROM transcripts t
    JOIN recordings r ON r.id = t.recording_id
    WHERE r.student_id = $1

    UNION ALL

    SELECT 'prompt_package_created'::text AS type,
           'ready'::text AS status,
           p.created_at,
           p.recording_id,
           p.transcript_id,
           p.id AS prompt_package_id,
           NULL::uuid AS draft_id,
           NULL::uuid AS job_id,
           r.source_path,
           r.storage_uri,
           NULL::text AS error
    FROM prompt_packages p
    LEFT JOIN recordings r ON r.id = p.recording_id
    WHERE p.student_id = $1

    UNION ALL

    SELECT 'draft_saved'::text AS type,
           'saved'::text AS status,
           d.created_at,
           p.recording_id,
           p.transcript_id,
           d.prompt_package_id,
           d.id AS draft_id,
           NULL::uuid AS job_id,
           r.source_path,
           r.storage_uri,
           NULL::text AS error
    FROM drafts d
    LEFT JOIN prompt_packages p ON p.id = d.prompt_package_id
    LEFT JOIN recordings r ON r.id = p.recording_id
    WHERE d.student_id = $1

    UNION ALL

    SELECT
      CASE
        WHEN j.state = 'awaiting_approval' THEN 'job_awaiting_approval'
        ELSE 'job_completed'
      END::text AS type,
      j.state::text AS status,
      COALESCE(j.finished_at, j.updated_at, j.created_at) AS created_at,
      j.recording_id,
      j.transcript_id,
      j.prompt_package_id,
      j.draft_id,
      j.id AS job_id,
      COALESCE(r.source_path, rp.source_path, rd.source_path) AS source_path,
      COALESCE(r.storage_uri, rp.storage_uri, rd.storage_uri) AS storage_uri,
      j.error
    FROM jobs j
    LEFT JOIN recordings r ON r.id = j.recording_id
    LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
    LEFT JOIN recordings rp ON rp.id = p.recording_id
    LEFT JOIN drafts d ON d.id = j.draft_id
    LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
    LEFT JOIN recordings rd ON rd.id = pd.recording_id
    WHERE COALESCE(r.student_id, p.student_id, d.student_id, pd.student_id) = $1
      AND j.state IN ('awaiting_approval', 'succeeded', 'failed')
  )
`;

export async function getStudentTimeline(
  studentId: string,
  params: StudentTimelineParams = {},
): Promise<StudentTimelineResponse> {
  const typeFilter = normalizeTypeFilter(params.types);
  const statusFilter = normalizeStatusFilter(params.statuses);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order ?? 'desc';

  const { rows, total } = await withPgClient(async (client) => {
    const values: (string | string[])[] = [studentId];
    const filters: string[] = [];
    let paramIndex = 2;

    if (typeFilter && typeFilter.size > 0) {
      values.push([...typeFilter]);
      filters.push(`type = ANY($${paramIndex}::text[])`);
      paramIndex += 1;
    }

    if (statusFilter && statusFilter.size > 0) {
      values.push([...statusFilter]);
      filters.push(`status = ANY($${paramIndex}::text[])`);
      paramIndex += 1;
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const countQuery = `${timelineQuery} SELECT COUNT(*)::int AS total FROM timeline ${whereClause}`;
    const countResult = await client.query(countQuery, values);

    const orderClause = order === 'asc' ? 'ASC' : 'DESC';
    const dataQuery = `${timelineQuery}
      SELECT type,
             status,
             created_at,
             recording_id,
             transcript_id,
             prompt_package_id,
             draft_id,
             job_id,
             source_path,
             storage_uri,
             error
      FROM timeline
      ${whereClause}
      ORDER BY created_at ${orderClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const dataValues = [...values, limit, offset];
    const dataResult = await client.query(dataQuery, dataValues);

    return {
      rows: dataResult.rows as TimelineRow[],
      total: countResult.rows[0]?.total ?? 0,
    };
  });

  const items = rows.map((row) => ({
    type: row.type,
    studentId,
    recordingId: row.recording_id,
    transcriptId: row.transcript_id,
    promptPackageId: row.prompt_package_id,
    draftId: row.draft_id,
    jobId: row.job_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    displayName: deriveDisplayName({
      fallbackId:
        row.job_id ??
        row.draft_id ??
        row.prompt_package_id ??
        row.transcript_id ??
        row.recording_id ??
        studentId,
      sourcePath: row.source_path,
      storageUri: row.storage_uri,
    }),
    details: row.error ? { error: row.error } : undefined,
  }));

  return {
    items,
    total,
    limit,
    offset,
    order,
  };
}
