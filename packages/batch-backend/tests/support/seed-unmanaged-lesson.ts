import { randomUUID } from 'node:crypto';

import type { StudentLessonStatus } from '@esl-pipeline/contracts';

import {
  getStudentScheduleBillingSurface,
  updateStudentLesson,
} from '../../src/application/student-schedule-billing.js';
import { setStudentActivityActor } from '../../src/domain/student-activity-recording.js';
import { withPgClient } from '../../src/infrastructure/db.js';

/** Fixture for retained, unmanaged ledger rows. This is not a runtime scheduling path. */
export async function seedUnmanagedLesson(
  workspaceId: string,
  studentId: string,
  params: {
    startsAt: string;
    timezone?: string;
    durationMinutes?: number;
    status?: StudentLessonStatus;
    consumesCredit?: boolean;
    title?: string | null;
    notes?: string | null;
  },
  actorUserId?: string | null,
) {
  const id = randomUUID();
  await withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await setStudentActivityActor(client, actorUserId);
      await client.query(
        `INSERT INTO student_lessons(id,student_id,workspace_id,starts_at,timezone,duration_minutes,status,consumes_credit,title,notes,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          id,
          studentId,
          workspaceId,
          params.startsAt,
          params.timezone ?? 'UTC',
          params.durationMinutes ?? 60,
          params.status === 'completed' || params.status === 'no_show'
            ? 'scheduled'
            : (params.status ?? 'scheduled'),
          params.consumesCredit ?? true,
          params.title ?? null,
          params.notes ?? null,
          actorUserId ?? null,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  if (params.status === 'completed' || params.status === 'no_show')
    return updateStudentLesson(
      workspaceId,
      studentId,
      id,
      { status: params.status, consumesCredit: params.consumesCredit ?? true },
      actorUserId,
    );
  return (await getStudentScheduleBillingSurface(workspaceId, studentId))!;
}
