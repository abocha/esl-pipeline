import type { PoolClient } from 'pg';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { ProcessLessonMemoryJobPayload } from '../application/process-lesson-memory-job.js';
import type { StudentMemoryQueuePayload } from '../application/process-student-memory-job.js';
import type { StudentMemorySnapshotRefreshStrategy } from '../application/student-memory-snapshot-generation-notes.js';
import { withPgClient } from '../infrastructure/db.js';
import { buildLessonMemoryExecutionSqlPredicate } from './lesson-memory-repository.js';

/** Serialize the delivery decision against source replacement and terminalization. */
export async function deliverCanonicalPendingLessonMemory(
  payload: ProcessLessonMemoryJobPayload,
  deliver: (client: PoolClient) => Promise<void>,
): Promise<boolean> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Import owns item/claim before student. Keep fencing and source admission
      // on this same client; a nested connection here can deadlock invisibly.
      await client.query(
        `SELECT item.id FROM student_memory_openai_batch_items item
        JOIN student_memory_openai_batch_claims claim ON claim.item_id = item.id
        WHERE claim.workload = 'lesson_memory' AND claim.canonical_scope_key = $1
          AND claim.state = 'active' ORDER BY item.id FOR UPDATE OF item, claim`,
        [payload.transcriptId],
      );
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [payload.studentId]);
      const eligible = await client.query(
        `SELECT l.id FROM lesson_memory_entries l WHERE l.id = $1 AND l.student_id = $2
         AND l.status = 'pending' AND l.assignment_session_id = $3
         AND l.transcript_id = $4 AND l.recording_id = $5
         AND l.source_storage_uri = $6 AND l.source_content_hash = $7
         AND ${buildLessonMemoryExecutionSqlPredicate('l')} FOR UPDATE OF l`,
        [
          payload.pendingEntryId,
          payload.studentId,
          payload.assignmentSessionId,
          payload.transcriptId,
          payload.recordingId,
          payload.sourceStorageUri,
          payload.sourceContentHash,
        ],
      );
      if (eligible.rows[0]) await deliver(client);
      await client.query('COMMIT');
      return Boolean(eligible.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

// The same rows own pre-generation intent and post-commit delivery intent.
// Rotating by delivery check time prevents a retained pending job starving later rows.
export async function listRecoverableMemoryDeliveries(
  limit = 50,
): Promise<StudentMemoryQueuePayload[]> {
  return withPgClient(async (client) => {
    const result = await client.query<{
      family: string;
      id: string;
      student_id: string;
      job_id: string | null;
      transcript_id: string | null;
      recording_id: string | null;
      assignment_session_id: string | null;
      source_storage_uri: string | null;
      source_content_hash: string | null;
      provider: GenerationProvider;
      model: string;
      generation_notes: Record<string, unknown> | null;
    }>(
      `WITH deliveries AS (SELECT 'homework' AS family, h.id, h.student_id, h.job_id, h.provider, h.model, h.generation_notes,
      NULL::uuid AS transcript_id, NULL::uuid AS recording_id, NULL::uuid AS assignment_session_id,
      NULL::text AS source_storage_uri, NULL::text AS source_content_hash
      FROM homework_memory_entries h
      WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.id = h.job_id AND j.assignment_artifact IS NOT NULL)
      AND (h.status = 'pending' OR (h.status = 'superseded' AND EXISTS (
        SELECT 1 FROM homework_memory_entries ready WHERE ready.id = h.superseded_by_id
        AND ready.status = 'ready' AND ready.generation_notes ->> 'pendingEntryId' = h.id::text
        AND NOT EXISTS (SELECT 1 FROM student_memory_snapshots s WHERE s.student_id = h.student_id
          AND (s.generation_notes ->> 'sourceEntryId' = ready.id::text OR ready.id = ANY(s.homework_memory_entry_ids))))))
      UNION ALL
      SELECT 'snapshot', s.id, s.student_id, NULL, s.provider, s.model, s.generation_notes,
      NULL, NULL, NULL, NULL, NULL
      FROM student_memory_snapshots s
      WHERE (s.status = 'pending' AND s.generation_notes ->> 'trigger' IN
        ('manual-replay', 'homework-memory-ready', 'lesson-memory-ready')) OR (s.status = 'superseded' AND EXISTS (
        SELECT 1 FROM student_memory_snapshots ready WHERE ready.id = s.superseded_by_id
        AND ready.status = 'ready' AND ready.generation_notes ->> 'pendingEntryId' = s.id::text
        AND ready.generation_notes #>> '{candidateRefresh,requested}' = 'true'
        AND ready.generation_notes #>> '{candidateRefresh,enqueueStatus}' IN ('pending', 'failed')))
      UNION ALL
      SELECT 'lesson', l.id, l.student_id, NULL, l.provider, l.model, l.generation_notes,
      l.transcript_id, l.recording_id, l.assignment_session_id, l.source_storage_uri, l.source_content_hash
      FROM lesson_memory_entries l
      WHERE l.status = 'pending' AND ${buildLessonMemoryExecutionSqlPredicate('l')}
      ) SELECT * FROM deliveries ORDER BY (generation_notes ->> 'deliveryCheckedAt') NULLS FIRST, id LIMIT $1`,
      [limit],
    );
    const payloads: StudentMemoryQueuePayload[] = [];
    for (const row of result.rows) {
      const notes = row.generation_notes ?? {};
      if (row.family === 'homework') {
        payloads.push({
          kind: 'homework-memory-generate',
          jobId: row.job_id!,
          studentId: row.student_id,
          pendingEntryId: row.id,
          provider: row.provider,
          model: row.model,
        });
      } else if (row.family === 'lesson') {
        payloads.push({
          kind: 'lesson-memory-generate',
          studentId: row.student_id,
          transcriptId: row.transcript_id!,
          recordingId: row.recording_id!,
          assignmentSessionId: row.assignment_session_id!,
          sourceStorageUri: row.source_storage_uri!,
          sourceContentHash: row.source_content_hash!,
          lessonId: typeof notes.lessonId === 'string' ? notes.lessonId : null,
          pendingEntryId: row.id,
          provider: row.provider,
          model: row.model,
        });
      } else {
        const trigger = notes.trigger;
        if (
          trigger !== 'manual-replay' &&
          trigger !== 'homework-memory-ready' &&
          trigger !== 'lesson-memory-ready'
        )
          continue;
        payloads.push({
          kind: 'student-memory-snapshot-refresh',
          studentId: row.student_id,
          pendingEntryId: row.id,
          provider: row.provider,
          model: row.model,
          trigger,
          sourceEntryId: typeof notes.sourceEntryId === 'string' ? notes.sourceEntryId : null,
          strategy: notes.strategy as StudentMemorySnapshotRefreshStrategy | null,
          operatorReason: typeof notes.operatorReason === 'string' ? notes.operatorReason : null,
          requestCandidateRefresh: notes.requestCandidateRefresh === true,
        });
      }
    }
    return payloads;
  });
}

// Bounded discovery is confined to the current canonical no-homework source or
// source-bound finish evidence still authoritative after promotion. Ordinary
// historical ready rows do not become a retrospective generation backlog.
export async function listReadyLessonMemoryMissingSnapshotObligations(limit = 50) {
  return withPgClient(async (client) => {
    const result = await client.query<{ id: string; student_id: string }>(
      `SELECT l.id, l.student_id FROM lesson_memory_entries l
       JOIN assignment_sessions a ON a.id = l.assignment_session_id
       WHERE l.status = 'ready' AND ${buildLessonMemoryExecutionSqlPredicate('l')}
         AND (a.homework_intent = 'none' OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(a.transcript_completion_history) event
           WHERE event -> 'source' = a.confirmed_snapshot -> 'source'))
         AND NOT EXISTS (SELECT 1 FROM student_memory_snapshots s WHERE s.student_id = l.student_id
           AND (s.generation_notes ->> 'sourceEntryId' = l.id::text
             OR l.id = ANY(s.lesson_memory_entry_ids)))
       ORDER BY l.generated_at, l.id LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({ sourceEntryId: row.id, studentId: row.student_id }));
  });
}

export async function markMemoryDeliveryChecked(payload: StudentMemoryQueuePayload) {
  if (
    payload.kind !== 'homework-memory-generate' &&
    payload.kind !== 'lesson-memory-generate' &&
    payload.kind !== 'student-memory-snapshot-refresh'
  )
    return;
  const table =
    payload.kind === 'homework-memory-generate'
      ? 'homework_memory_entries'
      : payload.kind === 'lesson-memory-generate'
        ? 'lesson_memory_entries'
        : 'student_memory_snapshots';
  await withPgClient((client) =>
    client.query(
      `UPDATE ${table} SET generation_notes =
    COALESCE(generation_notes, '{}'::jsonb) || jsonb_build_object('deliveryCheckedAt', clock_timestamp())
    WHERE id = $1${payload.kind === 'lesson-memory-generate' ? ` AND status = 'pending' AND ${buildLessonMemoryExecutionSqlPredicate('lesson_memory_entries')}` : ''}`,
      [payload.pendingEntryId],
    ),
  );
}

export async function cancelMemoryReplayIntent(args: {
  family: 'homework' | 'snapshot';
  studentId: string;
  pendingEntryId: string;
  reason: string;
}): Promise<boolean> {
  if (!args.reason.trim()) throw new Error('Cancellation reason is required');
  return retireMemoryReplayIntent(args, {
    cancelledAt: new Date().toISOString(),
    cancellationReason: args.reason.trim(),
  });
}

export async function obsoleteMemoryReplayIntent(args: {
  family: 'homework' | 'snapshot';
  studentId: string;
  pendingEntryId: string;
  reason: string;
}): Promise<boolean> {
  return retireMemoryReplayIntent(args, { obsoleteReason: args.reason });
}

async function retireMemoryReplayIntent(
  args: {
    family: 'homework' | 'snapshot';
    studentId: string;
    pendingEntryId: string;
  },
  notes: Record<string, string>,
): Promise<boolean> {
  const table = args.family === 'homework' ? 'homework_memory_entries' : 'student_memory_snapshots';
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      if (args.family === 'homework') {
        const intent = (
          await client.query<{ assignment_lineage_key: string }>(
            'SELECT assignment_lineage_key FROM homework_memory_entries WHERE id = $1 AND student_id = $2',
            [args.pendingEntryId, args.studentId],
          )
        ).rows[0];
        if (intent)
          await client.query('SELECT id FROM jobs WHERE id = $1 FOR UPDATE', [
            intent.assignment_lineage_key,
          ]);
      }
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [args.studentId]);
      const result = await client.query(
        `UPDATE ${table} SET status = 'superseded',
        generation_notes = COALESCE(generation_notes, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
        WHERE id = $1 AND student_id = $2 AND status IN ('pending', 'failed')
        AND superseded_by_id IS NULL RETURNING id`,
        [args.pendingEntryId, args.studentId, JSON.stringify(notes)],
      );
      await client.query('COMMIT');
      return result.rowCount === 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
