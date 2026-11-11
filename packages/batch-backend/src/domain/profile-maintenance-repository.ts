import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  ProfileChangeListDto,
  ProfileMaintenanceChangeDto,
  ProfileMaintenanceField,
  UndoProfileChangeDto,
} from '@esl-pipeline/contracts';

import {
  type FoundationalProfile,
  renderFoundationalProfileContent,
} from '../application/foundational-profile.js';
import {
  deriveMaintenanceAdditions,
  maintenanceFactKey,
  maintenanceField,
  normalizeMaintenanceFact,
  type ProfileFactSource,
} from '../application/profile-maintenance-policy.js';
import { withPgClient } from '../infrastructure/db.js';
import type { StudentFact } from './lesson-memory-model.js';
import { buildVerifiedLessonMemoryEvidenceSqlPredicate } from './lesson-memory-repository.js';
import { insertProfileRevisionWithClient } from './profile-revision-repository.js';
import {
  assertProfileHead,
  lockProfileHead,
  ProfileWriteConflictError,
} from './profile-write-authority.js';
import { buildProfileCandidateSourceSnapshotSqlPredicate } from './student-memory-snapshot-repository.js';

interface ChangeRow {
  id: string;
  student_id: string;
  fact_key: string;
  field: ProfileMaintenanceField;
  added_value: string;
  before_value: string[];
  after_value: string[];
  undo_expected_value: string[] | null;
  source_revision_id: string;
  result_revision_id: string;
  source_snapshot_id: string | null;
  source_lesson_memory_ids: string[];
  source_lesson_ids: string[];
  evidence: ProfileFactSource[];
  applied_at: Date;
  undo_blocked_at: Date | null;
  undo_blocked_reason: string | null;
  undo_revision_id: string | null;
  undone_at: Date | null;
  reconsideration_available?: boolean;
}

function dto(row: ChangeRow): ProfileMaintenanceChangeDto {
  return {
    id: row.id,
    field: row.field,
    addedValue: row.added_value,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    appliedAt: row.applied_at.toISOString(),
    sourceRevisionId: row.source_revision_id,
    resultRevisionId: row.result_revision_id,
    sourceSnapshotId: row.source_snapshot_id,
    sourceLessonMemoryIds: row.source_lesson_memory_ids,
    sourceLessonIds: row.source_lesson_ids,
    evidence: row.evidence.map((source) => ({
      lessonMemoryId: source.id,
      lessonId: source.sourceLessonId,
      lessonStartedAt: source.sourceLessonStartedAt,
      facts: source.facts.map((fact) => ({
        fact: fact.fact,
        evidence: fact.evidence.map((e) => ({
          quote: e.quote,
          speakerRole: e.speakerRole ?? null,
          sourceId: e.sourceId ?? null,
        })),
      })),
    })),
    status: row.undone_at ? 'undone' : row.undo_blocked_at ? 'blocked' : 'applied',
    canUndo: !row.undone_at && !row.undo_blocked_at,
    blockedReason: row.undo_blocked_reason,
    undoneAt: row.undone_at?.toISOString() ?? null,
    reconsiderationAvailable: row.reconsideration_available ?? false,
  };
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function listProfileMaintenanceChanges(
  studentId: string,
  cursor: string | null = null,
): Promise<ProfileChangeListDto> {
  return transaction(async (client) => {
    const head = await lockProfileHead(client, studentId);
    const rows = await client.query<ChangeRow>(
      `SELECT c.*, COALESCE(jsonb_array_length(s.reconsideration_evidence)>0,false) AS reconsideration_available
       FROM student_profile_maintenance_changes c
       LEFT JOIN student_profile_fact_suppressions s ON s.student_id=c.student_id AND s.fact_key=c.fact_key
       WHERE c.student_id=$1 AND ($2::uuid IS NULL OR (c.applied_at,c.id) <
         (SELECT applied_at,id FROM student_profile_maintenance_changes WHERE student_id=$1 AND id=$2))
       ORDER BY c.applied_at DESC,c.id DESC LIMIT 51`,
      [studentId, cursor],
    );
    const page = rows.rows.slice(0, 50);
    return {
      studentId,
      activeRevisionId: head?.id ?? null,
      items: page.map(dto),
      nextCursor: rows.rows.length > 50 ? page.at(-1)!.id : null,
    };
  });
}

export async function undoProfileMaintenanceChange(args: {
  studentId: string;
  changeId: string;
  expectedActiveRevisionId: string | null;
  actorUserId: string;
}): Promise<UndoProfileChangeDto | null> {
  return transaction(async (client) => {
    const head = await lockProfileHead(client, args.studentId);
    const result = await client.query<ChangeRow>(
      'SELECT * FROM student_profile_maintenance_changes WHERE student_id=$1 AND id=$2 FOR UPDATE',
      [args.studentId, args.changeId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.undone_at) {
      // A lost response must not execute again, even if later work has advanced the head.
      if (!head) throw new ProfileWriteConflictError('profile_revision_conflict', null);
      return {
        profile: {
          studentId: args.studentId,
          content: head.content,
          structuredContent: head.structured_content as FoundationalProfile | null,
          currentRevisionId: head.id,
          activeRevisionId: head.id,
          updatedAt: head.created_at.toISOString(),
        },
        change: dto(row),
      };
    }
    assertProfileHead(args.expectedActiveRevisionId, head?.id ?? null);
    const profile = head?.structured_content as FoundationalProfile | null;
    if (
      !head ||
      !profile ||
      row.undo_blocked_at ||
      JSON.stringify(profile[row.field]) !==
        JSON.stringify(row.undo_expected_value ?? row.after_value)
    )
      throw new ProfileWriteConflictError('profile_change_conflict', head?.id ?? null);
    const updated = {
      ...profile,
      [row.field]: profile[row.field].filter((value) => value !== row.added_value),
    };
    if (updated[row.field].length !== profile[row.field].length - 1)
      throw new ProfileWriteConflictError('profile_change_conflict', head.id);
    await client.query("SELECT set_config('app.profile_maintenance_undo_change_id',$1,true)", [
      row.id,
    ]);
    const content = renderFoundationalProfileContent(updated);
    const revision = await insertProfileRevisionWithClient(client, {
      studentId: args.studentId,
      expectedActiveRevisionId: head.id,
      content,
      structuredContent: updated,
      contentHash: createHash('sha256').update(content).digest('hex'),
      source: 'maintenance_undo',
      status: 'active',
      createdBy: args.actorUserId,
    });
    await client.query(
      `INSERT INTO student_profile_fact_suppressions(student_id,fact_key,change_id,reason)
      VALUES($1,$2,$3,'tutor_undo') ON CONFLICT(student_id,fact_key) DO UPDATE SET reason='tutor_undo'`,
      [args.studentId, row.fact_key, row.id],
    );
    const undone = await client.query<ChangeRow>(
      'UPDATE student_profile_maintenance_changes SET undo_revision_id=$3,undone_at=clock_timestamp(),undone_by=$4 WHERE student_id=$1 AND id=$2 RETURNING *',
      [args.studentId, row.id, revision.id, args.actorUserId],
    );
    return {
      profile: {
        studentId: args.studentId,
        content,
        structuredContent: updated,
        currentRevisionId: revision.id,
        activeRevisionId: revision.id,
        updatedAt: revision.createdAt.toISOString(),
      },
      change: dto(undone.rows[0]!),
    };
  });
}

/** Runs under the existing queue; no provider request or snapshot substitution. */
export async function reconcileAutomaticProfileMaintenance(
  studentId: string,
  sourceSnapshotId: string,
): Promise<number> {
  return transaction(async (client) => {
    const head = await lockProfileHead(client, studentId);
    const student = await client.query(
      'SELECT 1 FROM students WHERE id=$1 AND archived_at IS NULL',
      [studentId],
    );
    if (!student.rows[0] || !head?.structured_content) return 0;
    const snapshotResult = await client.query<{
      lesson_memory_entry_ids: string[];
      generation_notes: Record<string, unknown>;
    }>(
      `SELECT lesson_memory_entry_ids,generation_notes FROM student_memory_snapshots snapshot WHERE id=$1 AND student_id=$2
       AND ${buildProfileCandidateSourceSnapshotSqlPredicate('snapshot')}`,
      [sourceSnapshotId, studentId],
    );
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) return 0;
    const notes = snapshot.generation_notes ?? {};
    const triggerId =
      typeof notes.triggerSourceEntryId === 'string'
        ? notes.triggerSourceEntryId
        : typeof notes.sourceEntryId === 'string'
          ? notes.sourceEntryId
          : null;
    const selected =
      notes.triggerSourceKind === 'homework_memory' &&
      Array.isArray(notes.includedLessonMemoryEntryIds)
        ? notes.includedLessonMemoryEntryIds.filter((id): id is string => typeof id === 'string')
        : triggerId
          ? [triggerId]
          : [];
    if (!selected.length || selected.some((id) => !snapshot.lesson_memory_entry_ids.includes(id)))
      return 0;
    const sourceRows = await client.query<{
      id: string;
      student_facts: StudentFact[];
      source_content_hash: string;
      lesson_id: string | null;
      lesson_at: Date | null;
    }>(
      `SELECT l.id,l.student_facts,l.source_content_hash,
         CASE WHEN lesson.status='completed' THEN lesson.id END AS lesson_id,
         CASE WHEN lesson.status='completed' THEN lesson.starts_at END AS lesson_at
       FROM lesson_memory_entries l LEFT JOIN assignment_sessions a ON a.id=l.assignment_session_id AND a.student_id=l.student_id
       LEFT JOIN student_lessons lesson ON lesson.id=a.lesson_id AND lesson.student_id=l.student_id
       WHERE l.id=ANY($1::uuid[]) AND l.student_id=$2 AND l.status='ready' AND l.source_content_hash IS NOT NULL
         AND ${buildVerifiedLessonMemoryEvidenceSqlPredicate('l')}`,
      [snapshot.lesson_memory_entry_ids, studentId],
    );
    if (sourceRows.rows.length !== new Set(snapshot.lesson_memory_entry_ids).size) return 0;
    const sources: ProfileFactSource[] = sourceRows.rows.map((r) => ({
      id: r.id,
      sourceContentHash: r.source_content_hash,
      sourceLessonId: r.lesson_id,
      sourceLessonStartedAt: r.lesson_at?.toISOString() ?? null,
      facts: r.student_facts,
    }));
    const additions = deriveMaintenanceAdditions(sources, selected);
    const reviewed = await client.query<{
      id: string;
      target_section: string;
      fact: string;
      approved_fact: string | null;
      review_state: string;
    }>(
      'SELECT id,target_section,fact,approved_fact,review_state FROM student_profile_candidates WHERE student_id=$1 ORDER BY id FOR UPDATE',
      [studentId],
    );
    const rejectedKeys = new Set(
      reviewed.rows
        .filter((r) => r.review_state !== 'unreviewed')
        .flatMap((r) => {
          const field = maintenanceField(r.target_section);
          return field
            ? [
                maintenanceFactKey(field, r.fact),
                maintenanceFactKey(field, r.approved_fact ?? r.fact),
              ]
            : [];
        }),
    );
    const profile = head.structured_content as FoundationalProfile;
    const next = structuredClone(profile);
    const admitted: typeof additions = [];
    for (const addition of additions) {
      if (rejectedKeys.has(addition.factKey)) continue;
      const suppressed = await client.query<{
        change_id: string;
        source_latest_lesson_at: Date | null;
        source_lesson_ids: string[];
      }>(
        `SELECT s.change_id,COALESCE(s.source_latest_lesson_at,c.source_latest_lesson_at) AS source_latest_lesson_at,CASE WHEN s.source_latest_lesson_at IS NOT NULL THEN s.source_lesson_ids ELSE c.source_lesson_ids END AS source_lesson_ids FROM student_profile_fact_suppressions s
         LEFT JOIN student_profile_maintenance_changes c ON c.student_id=s.student_id AND c.id=s.change_id
         WHERE s.student_id=$1 AND s.fact_key=$2 FOR UPDATE OF s`,
        [studentId, addition.factKey],
      );
      if (suppressed.rows[0]) {
        const old = suppressed.rows[0];
        const newer = addition.sources.filter(
          (s) =>
            s.sourceLessonId &&
            !old.source_lesson_ids.includes(s.sourceLessonId) &&
            s.sourceLessonStartedAt &&
            old.source_latest_lesson_at &&
            new Date(s.sourceLessonStartedAt) > old.source_latest_lesson_at,
        );
        if (newer.length)
          await client.query(
            'UPDATE student_profile_fact_suppressions SET reconsideration_evidence=$3::jsonb WHERE student_id=$1 AND fact_key=$2',
            [studentId, addition.factKey, JSON.stringify(newer)],
          );
        continue;
      }
      if (
        next[addition.field].some(
          (value) => normalizeMaintenanceFact(value) === normalizeMaintenanceFact(addition.value),
        )
      )
        continue;
      const existing = await client.query(
        'SELECT 1 FROM student_profile_maintenance_changes WHERE student_id=$1 AND fact_key=$2',
        [studentId, addition.factKey],
      );
      if (existing.rows[0]) continue;
      next[addition.field].push(addition.value);
      admitted.push(addition);
    }
    if (!admitted.length) return 0;
    const content = renderFoundationalProfileContent(next);
    const revision = await insertProfileRevisionWithClient(client, {
      studentId,
      expectedActiveRevisionId: head.id,
      content,
      structuredContent: next,
      contentHash: createHash('sha256').update(content).digest('hex'),
      source: 'automatic_maintenance',
      status: 'active',
    });
    for (const addition of admitted) {
      const candidateIds = reviewed.rows
        .filter(
          (r) =>
            r.review_state === 'unreviewed' &&
            maintenanceField(r.target_section) === addition.field &&
            maintenanceFactKey(addition.field, r.fact) === addition.factKey,
        )
        .map((r) => r.id);
      if (candidateIds.length)
        await client.query(
          "UPDATE student_profile_candidates SET status='superseded',dedup_decision=jsonb_build_object('decision','automatic_maintenance','revisionId',$3::text) WHERE student_id=$1 AND id=ANY($2::uuid[]) AND status='pending_review'",
          [studentId, candidateIds, revision.id],
        );
      const latest =
        addition.sources
          .map((s) => s.sourceLessonStartedAt)
          .filter((s): s is string => Boolean(s))
          .sort()
          .at(-1) ?? null;
      await client.query(
        `INSERT INTO student_profile_maintenance_changes
        (student_id,application_key,policy_version,fact_key,field,added_value,before_value,after_value,evidence,
         source_snapshot_id,source_lesson_memory_ids,source_lesson_ids,source_latest_lesson_at,source_revision_id,result_revision_id)
        VALUES($1,$2,'deterministic_v1',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
        [
          studentId,
          `${sourceSnapshotId}:${addition.factKey}`,
          addition.factKey,
          addition.field,
          addition.value,
          JSON.stringify(profile[addition.field]),
          JSON.stringify(next[addition.field]),
          JSON.stringify(addition.sources),
          sourceSnapshotId,
          [...new Set(addition.sources.map((s) => s.id))],
          [...new Set(addition.sources.map((s) => s.sourceLessonId).filter(Boolean))],
          latest,
          head.id,
          revision.id,
        ],
      );
    }
    return admitted.length;
  });
}

/** Initial enrichment already owns assignment -> student -> operation and source validation. */
export async function recordInitialProfileMaintenance(
  client: PoolClient,
  args: {
    studentId: string;
    operationId: string;
    sourceRevisionId: string;
    resultRevisionId: string;
    seed: FoundationalProfile;
    result: FoundationalProfile;
    sources: ProfileFactSource[];
  },
): Promise<void> {
  for (const addition of deriveMaintenanceAdditions(
    args.sources,
    args.sources.map((s) => s.id),
  )) {
    if (
      args.seed[addition.field].some(
        (v) => normalizeMaintenanceFact(v) === normalizeMaintenanceFact(addition.value),
      ) ||
      !args.result[addition.field].includes(addition.value)
    )
      continue;
    const suppressed = await client.query(
      'SELECT 1 FROM student_profile_fact_suppressions WHERE student_id=$1 AND fact_key=$2',
      [args.studentId, addition.factKey],
    );
    if (suppressed.rows[0])
      throw new Error('Initial profile publication attempted to restore a suppressed fact');
    await client.query(
      `INSERT INTO student_profile_maintenance_changes
      (student_id,application_key,policy_version,fact_key,field,added_value,before_value,after_value,evidence,
       initial_operation_id,source_lesson_memory_ids,source_lesson_ids,source_revision_id,result_revision_id)
      VALUES($1,$2,'deterministic_v1',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,'{}',$11,$12)`,
      [
        args.studentId,
        `${args.operationId}:${addition.factKey}`,
        addition.factKey,
        addition.field,
        addition.value,
        JSON.stringify(args.seed[addition.field]),
        JSON.stringify(args.result[addition.field]),
        JSON.stringify(addition.sources),
        args.operationId,
        [...new Set(addition.sources.map((s) => s.id))],
        args.sourceRevisionId,
        args.resultRevisionId,
      ],
    );
  }
}
