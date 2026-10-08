import type { StudentMemoryAvailability } from '@esl-pipeline/contracts';

import { buildVerifiedLessonMemoryEvidenceSqlPredicate } from '../domain/lesson-memory-repository.js';
import {
  buildEligibleStudentMemorySnapshotLineageSqlPredicate,
  readStudentMemorySnapshotSelection,
} from '../domain/student-memory-snapshot-repository.js';
import { withPgClient } from '../infrastructure/db.js';

type MemoryStatus = 'not_requested' | 'pending' | 'ready' | 'failed' | 'superseded';
export interface TranscriptProcessingStatus {
  availability: StudentMemoryAvailability;
  lessonMemory: MemoryStatus;
  snapshot: MemoryStatus;
  enrichment: MemoryStatus | 'not_eligible' | 'uncertain';
}

/** Read-only projection: a published extraction alone is not a completed refresh. */
export async function getTranscriptProcessingStatus(
  sessionId: string,
): Promise<TranscriptProcessingStatus> {
  return withPgClient(async (client) => {
    const eligibleSnapshotLineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate('s');
    const result = await client.query<{
      lesson_status: MemoryStatus | null;
      snapshot_status: MemoryStatus | null;
      enrichment_state: string | null;
      enrichment_eligible: boolean;
      enrichment_uncertain: boolean;
      student_id: string;
    }>(
      `SELECT a.student_id, lesson.status AS lesson_status, snapshot.status AS snapshot_status,
         enrichment.state AS enrichment_state,
         (student.profile_provenance = 'tutor_only' AND lesson.id IS NOT NULL) AS enrichment_eligible,
         EXISTS (SELECT 1 FROM profile_initial_enrichment_operations op
           WHERE op.student_id = a.student_id AND op.state = 'uncertain') AS enrichment_uncertain
       FROM assignment_sessions a
       JOIN students student ON student.id = a.student_id
       LEFT JOIN LATERAL (
         SELECT l.* FROM lesson_memory_entries l WHERE l.assignment_session_id = a.id
           AND ${buildVerifiedLessonMemoryEvidenceSqlPredicate('l')}
         ORDER BY l.generated_at DESC, l.id DESC LIMIT 1
       ) lesson ON TRUE
       LEFT JOIN LATERAL (
         SELECT CASE WHEN s.status = 'ready' AND NOT (${eligibleSnapshotLineage})
           THEN 'superseded' ELSE s.status END AS status
         FROM student_memory_snapshots s WHERE s.student_id = a.student_id
           AND (s.generation_notes ->> 'sourceEntryId' = lesson.id::text
             OR (s.status = 'ready' AND lesson.id = ANY(s.lesson_memory_entry_ids)))
         ORDER BY (s.status = 'ready' AND ${eligibleSnapshotLineage}) DESC,
           s.created_at DESC, s.id DESC LIMIT 1
       ) snapshot ON TRUE
       LEFT JOIN LATERAL (
         SELECT op.state FROM profile_initial_enrichment_operations op
         WHERE op.assignment_session_id = a.id
           AND op.transcript_id::text = a.confirmed_snapshot #>> '{source,transcriptId}'
           AND op.transcript_hash = a.confirmed_snapshot #>> '{source,transcriptHash}'
         ORDER BY op.created_at DESC, op.id DESC LIMIT 1
       ) enrichment ON TRUE
       WHERE a.id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    const enrichment: TranscriptProcessingStatus['enrichment'] =
      row?.enrichment_state === 'succeeded'
        ? 'ready'
        : row?.enrichment_state === 'failed'
          ? 'failed'
          : row?.enrichment_state === 'uncertain'
            ? 'uncertain'
            : row?.enrichment_state === 'superseded'
              ? 'superseded'
              : row?.enrichment_state
                ? 'pending'
                : row?.enrichment_eligible && row.enrichment_uncertain
                  ? 'uncertain'
                  : row?.enrichment_eligible
                    ? 'pending'
                    : 'not_eligible';
    return {
      availability: row?.student_id
        ? (await readStudentMemorySnapshotSelection(client, row.student_id)).availability
        : {
            state: 'absent',
            reason: 'no_established_snapshot',
            lessonReferenceCount: 0,
            homeworkReferenceCount: 0,
          },
      lessonMemory: row?.lesson_status ?? 'not_requested',
      snapshot:
        row?.snapshot_status ?? (row?.lesson_status === 'ready' ? 'pending' : 'not_requested'),
      enrichment,
    };
  });
}
