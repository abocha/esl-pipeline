import { randomUUID } from 'node:crypto';

import { withPgClient } from '../../src/infrastructure/db.js';

export async function insertLessonMemory(args: {
  studentId: string;
  status: 'ready' | 'superseded';
  withConfirmedSource: boolean;
}) {
  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  const lessonMemoryId = randomUUID();
  const assignmentSessionId = args.withConfirmedSource ? randomUUID() : null;
  const userId = randomUUID();
  const sourceStorageUri = args.withConfirmedSource
    ? `local://confirmed/${transcriptId}.txt`
    : `local://transcripts/${transcriptId}.txt`;
  await withPgClient(async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, 'hash', 'user')`,
      [userId, `${userId}@example.test`],
    );
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       SELECT workspace_id, $2, 'owner' FROM students WHERE id = $1`,
      [args.studentId, userId],
    );
    await client.query(
      `INSERT INTO recordings
         (id, source, student_id, source_path, storage_uri, bytes, status,
          source_identity_kind, source_fingerprint_scheme, source_fingerprint,
          created_at, updated_at)
       VALUES ($1::uuid, 'upload', $2, 'lesson.wav', $3, 100, 'ingested',
         'audio', 'prepared-media-sha256-v1',
         replace(($1::uuid)::text, '-', '') || replace(($1::uuid)::text, '-', ''),
         NOW(), NOW())`,
      [recordingId, args.studentId, `local://recordings/${recordingId}.wav`],
    );
    await client.query(
      `INSERT INTO transcripts
         (id, recording_id, storage_uri, mode, model, language, stt_provider,
          fallback_used, working_version, content_hash, created_at, updated_at)
       VALUES ($1, $2, $3, 'timeline', 'nova-3', 'multi', 'deepgram', FALSE,
         1, $4, NOW(), NOW())`,
      [transcriptId, recordingId, sourceStorageUri, 'a'.repeat(64)],
    );
    if (assignmentSessionId) {
      await client.query(
        `INSERT INTO assignment_sessions (
           id, user_id, student_id, recording_id, transcript_id, revision,
           confirmed_step, confirmed_snapshot
         ) VALUES ($1, $2, $3, $4, $5, 2, 'source', $6::jsonb)`,
        [
          assignmentSessionId,
          userId,
          args.studentId,
          recordingId,
          transcriptId,
          JSON.stringify({
            student: { studentId: args.studentId },
            source: {
              lessonId: null,
              recordingId,
              transcriptId,
              transcriptWorkingVersion: 1,
              transcriptStorageUri: sourceStorageUri,
              transcriptHash: 'a'.repeat(64),
              sourceIdentityKind: 'audio',
              sourceFingerprintScheme: 'prepared-media-sha256-v1',
              sourceFingerprint: recordingId.replaceAll('-', '').repeat(2),
            },
            context: null,
            create: null,
          }),
        ],
      );
      await client.query(
        `INSERT INTO assignment_source_bindings (
           id, workspace_id, user_id, student_id, assignment_session_id,
           source_identity_kind, source_fingerprint_scheme, source_fingerprint,
           binding_role, recording_id, transcript_id
         ) SELECT $1, s.workspace_id, $2, $3, $4, 'audio', 'prepared-media-sha256-v1',
                  replace(($5::uuid)::text, '-', '') || replace(($5::uuid)::text, '-', ''),
                  'confirmed', $5, $6
           FROM students s WHERE s.id = $3`,
        [randomUUID(), userId, args.studentId, assignmentSessionId, recordingId, transcriptId],
      );
    }
    await client.query(
      `INSERT INTO lesson_memory_entries
         (id, student_id, transcript_id, recording_id, schema_version, generated_at,
           provider, model, status, source_kind, source_storage_uri, source_content_hash,
           assignment_session_id)
       VALUES ($1, $2, $3, $4, 'lesson-memory.v1', NOW(), 'openai', 'gpt-5.2', $5,
               'lesson_transcript', $6, $7, $8)`,
      [
        lessonMemoryId,
        args.studentId,
        transcriptId,
        recordingId,
        args.status,
        args.withConfirmedSource ? sourceStorageUri : null,
        args.withConfirmedSource ? 'a'.repeat(64) : null,
        assignmentSessionId,
      ],
    );
  });
  return lessonMemoryId;
}

/** Seed preserved pre-cutover authority in disposable PostgreSQL fixtures only. */
export async function makeLessonMemorySourcesHistorical(ids: string[]) {
  await withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        'ALTER TABLE assignment_sessions DISABLE TRIGGER historical_sessions_read_only',
      );
      await client.query(
        `UPDATE assignment_sessions SET confirmed_snapshot =
        jsonb_set(confirmed_snapshot, '{create}', '{"markdown":"Frozen historical assignment"}'::jsonb)
        WHERE id IN (SELECT assignment_session_id FROM lesson_memory_entries WHERE id = ANY($1::uuid[]))`,
        [ids],
      );
      await client.query(
        'ALTER TABLE assignment_sessions ENABLE TRIGGER historical_sessions_read_only',
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
