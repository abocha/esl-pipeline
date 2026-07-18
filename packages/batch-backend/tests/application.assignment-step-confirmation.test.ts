import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationCandidates: vi.fn(() => [{ provider: 'openai', model: 'gpt-5.2' }]),
}));

import { confirmAssignmentSessionStep } from '../src/application/confirm-assignment-session-step.js';
import {
  confirmAssignmentSessionStepPersistence,
  confirmStudentAssignmentSession,
  updateAssignmentSessionRecovery,
} from '../src/domain/assignment-session-repository.js';
import { insertDraft } from '../src/domain/draft-repository.js';
import { publishConfirmedLessonMemoryEntry } from '../src/domain/lesson-memory-repository.js';
import { insertPromptPackage } from '../src/domain/prompt-package-repository.js';
import { updateTranscriptWorkingContent } from '../src/domain/transcript-repository.js';
import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

describe('application/confirm-assignment-session-step', () => {
  const sessionRecord = {
    id: 'session-1',
    userId: 'user-1',
    studentId: 'student-1',
    lessonId: null,
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    promptPackageId: null,
    draftId: null,
    revision: 2,
    confirmedStep: 'source' as const,
    confirmed: {
      student: { studentId: 'student-1' },
      source: {
        lessonId: null,
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
        transcriptStorageUri: 's3://transcripts/content/a.txt',
        transcriptHash: 'a'.repeat(64),
      },
      context: null,
      create: null,
    },
    creationRequestId: null,
    publishTarget: null,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    selectedProfileId: null,
    selectedProfileRevisionId: null,
    selectedProfileRevisionHash: null,
    shareJobId: null,
    createdAt: new Date('2026-07-19T00:00:00Z'),
    updatedAt: new Date('2026-07-19T00:01:00Z'),
  };

  it('enqueues the exact confirmed Source intent after the transaction commits', async () => {
    const confirm = vi.fn().mockResolvedValue({
      session: sessionRecord,
      invalidated: ['prompt', 'draft', 'preview'],
      lessonMemoryIntent: {
        outcome: 'created',
        entryId: 'memory-1',
        sourceStorageUri: 's3://transcripts/content/a.txt',
        sourceContentHash: 'a'.repeat(64),
      },
    });
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await confirmAssignmentSessionStep({
      config: { generation: {} } as never,
      userId: 'user-1',
      sessionId: 'session-1',
      request: {
        step: 'source',
        expectedRevision: 1,
        lessonId: null,
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
      },
      overrides: {
        confirmation: { confirm },
        lessonMemory: { enqueueConfirmedIntent: enqueue },
      } as never,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingEntryId: 'memory-1',
        sourceStorageUri: 's3://transcripts/content/a.txt',
        sourceContentHash: 'a'.repeat(64),
      }),
    );
    expect(result.invalidated).toEqual(['prompt', 'draft', 'preview']);
  });

  it('does not enqueue or report invalidation for an identical Source replay', async () => {
    const enqueue = vi.fn();
    const session = sessionRecord;

    const result = await confirmAssignmentSessionStep({
      config: { generation: {} } as never,
      userId: 'user-1',
      sessionId: 'session-1',
      request: {
        step: 'source',
        expectedRevision: 1,
        lessonId: null,
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
      },
      overrides: {
        confirmation: {
          confirm: vi.fn().mockResolvedValue({
            session,
            invalidated: [],
            lessonMemoryIntent: null,
          }),
        },
        lessonMemory: { enqueueConfirmedIntent: enqueue },
      } as never,
    });

    expect(result).toMatchObject({ session: { id: session.id, revision: 2 }, invalidated: [] });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('application/confirm-assignment-session-step transactional persistence', () => {
  it('captures exact Source provenance, replays idempotently, and supersedes A when B is confirmed', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const sourceAHash = '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd';
    const sourceBHash = 'df7e70e5021544f4834bbee64a9e3789febc4be81470df629cad6ddb03320a5c';
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        'TRUNCATE TABLE assignment_sessions, lesson_memory_entries, transcripts, recordings, students, users RESTART IDENTITY CASCADE',
      );
      await client.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')`,
        [userId, `${userId}@example.test`],
      );
      await client.query(`INSERT INTO students (id, student) VALUES ($1, 'Alpha')`, [studentId]);
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 's3://recordings/a.mp3', 1, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, working_version, content_hash, stt_provider,
           mode, model, language, fallback_used
         ) VALUES ($1, $2, 's3://transcripts/content/a.txt', 1, $3, 'deepgram',
                   'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, sourceAHash],
      );
    });
    const student = await confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    const memory = {
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      requestedAt: new Date('2026-07-19T00:00:00Z'),
    };
    const sourceRequest = {
      step: 'source' as const,
      expectedRevision: 1,
      lessonId: null,
      recordingId,
      transcriptId,
      transcriptWorkingVersion: 1,
    };

    const confirmedA = await confirmAssignmentSessionStepPersistence({
      id: student.id,
      userId,
      request: sourceRequest,
      lessonMemory: memory,
    });
    expect(confirmedA.session).toMatchObject({
      revision: 2,
      confirmedStep: 'source',
      confirmed: {
        source: {
          transcriptWorkingVersion: 1,
          transcriptStorageUri: 's3://transcripts/content/a.txt',
          transcriptHash: sourceAHash,
        },
      },
    });
    expect(confirmedA.invalidated).toEqual(['prompt', 'draft', 'preview']);

    const replay = await confirmAssignmentSessionStepPersistence({
      id: student.id,
      userId,
      request: sourceRequest,
      lessonMemory: memory,
    });
    expect(replay.session.revision).toBe(2);
    expect(replay.invalidated).toEqual([]);
    expect(replay.lessonMemoryIntent).toMatchObject({ outcome: 'pending_exists' });
    const readySnapshotId = randomUUID();
    const pendingSnapshotId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO student_memory_snapshots (
           id, student_id, schema_version, generated_at, provider, model, status,
           lesson_memory_entry_ids
         ) VALUES
           ($1, $3, 'student-memory.v1', NOW(), 'openai', 'gpt-5.2', 'ready', $4::uuid[]),
           ($2, $3, 'student-memory.v1', NOW(), 'openai', 'gpt-5.2', 'pending', ARRAY[]::uuid[])`,
        [readySnapshotId, pendingSnapshotId, studentId, [confirmedA.lessonMemoryIntent!.entryId]],
      );
    });

    await updateTranscriptWorkingContent({
      id: transcriptId,
      expectedWorkingVersion: 1,
      storageUri: 's3://transcripts/content/b.txt',
      contentHash: sourceBHash,
    });
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: student.id,
        userId,
        request: sourceRequest,
        lessonMemory: memory,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_WORKING_CONFLICT' });

    const confirmedB = await confirmAssignmentSessionStepPersistence({
      id: student.id,
      userId,
      request: { ...sourceRequest, expectedRevision: 2, transcriptWorkingVersion: 2 },
      lessonMemory: { ...memory, requestedAt: new Date('2026-07-19T00:01:00Z') },
    });
    expect(confirmedB.session).toMatchObject({
      revision: 3,
      confirmed: {
        source: {
          transcriptWorkingVersion: 2,
          transcriptStorageUri: 's3://transcripts/content/b.txt',
          transcriptHash: sourceBHash,
        },
      },
    });
    const rows = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ source_content_hash: string; status: string }>(
        `SELECT source_content_hash, status FROM lesson_memory_entries
         WHERE transcript_id = $1 ORDER BY generated_at`,
        [transcriptId],
      ),
    );
    expect(rows.rows).toEqual([
      { source_content_hash: sourceAHash, status: 'superseded' },
      { source_content_hash: sourceBHash, status: 'pending' },
    ]);
    const snapshotStatuses = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ id: string; status: string }>(
        `SELECT id, status FROM student_memory_snapshots
           WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[readySnapshotId, pendingSnapshotId]],
      ),
    );
    expect(snapshotStatuses.rows.map((row) => row.status)).toEqual(['superseded', 'superseded']);
    const lateA = await publishConfirmedLessonMemoryEntry({
      id: confirmedA.lessonMemoryIntent!.entryId,
      studentId,
      transcriptId,
      recordingId,
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      sourceStorageUri: 's3://transcripts/content/a.txt',
      sourceContentHash: sourceAHash,
    });
    expect(lateA).toBeNull();

    const recovered = await updateAssignmentSessionRecovery({
      id: student.id,
      userId,
      expectedRevision: 3,
      patch: { teacherNotes: 'other tab' },
    });
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: student.id,
        userId,
        request: {
          step: 'context',
          expectedRevision: 3,
          teacherNotes: 'stale tab',
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
        lessonMemory: memory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
      session: expect.objectContaining({ revision: recovered.revision }),
    });
  });

  it('requires confirmed prerequisites and captures exact Create lineage', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const transcriptHash = 'a'.repeat(64);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        'TRUNCATE TABLE assignment_sessions, lesson_memory_entries, transcripts, recordings, students, users RESTART IDENTITY CASCADE',
      );
      await client.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')`,
        [userId, `${userId}@example.test`],
      );
      await client.query(`INSERT INTO students (id, student) VALUES ($1, 'Alpha')`, [studentId]);
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 's3://recordings/a.mp3', 1, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, working_version, content_hash, stt_provider,
           mode, model, language, fallback_used
         ) VALUES ($1, $2, 's3://transcripts/content/a.txt', 1, $3, 'deepgram',
                   'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, transcriptHash],
      );
    });
    const session = await confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    const memory = {
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      requestedAt: new Date(),
    };
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: session.id,
        userId,
        request: {
          step: 'context',
          expectedRevision: 1,
          teacherNotes: null,
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
        lessonMemory: memory,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_STEP_PREREQUISITE_MISSING' });

    const source = await confirmAssignmentSessionStepPersistence({
      id: session.id,
      userId,
      request: {
        step: 'source',
        expectedRevision: 1,
        lessonId: null,
        recordingId,
        transcriptId,
        transcriptWorkingVersion: 1,
      },
      lessonMemory: memory,
    });
    const context = await confirmAssignmentSessionStepPersistence({
      id: session.id,
      userId,
      request: {
        step: 'context',
        expectedRevision: source.session.revision,
        teacherNotes: null,
        profileId: null,
        profileRevisionId: null,
        profileRevisionHash: null,
      },
      lessonMemory: memory,
    });
    const prompt = await insertPromptPackage({
      recordingId,
      transcriptId,
      studentId,
      lessonId: null,
      templateVersion: 'template-v1',
      notes: null,
      storageUri: 's3://prompts/prompt.json',
    });
    const draft = await insertDraft({
      promptPackageId: prompt.id,
      studentId,
      lessonId: null,
      storageUri: 's3://drafts/content/a.md',
      workingVersion: 1,
      contentHash: 'b'.repeat(64),
      createdBy: userId,
    });
    const created = await confirmAssignmentSessionStepPersistence({
      id: session.id,
      userId,
      request: {
        step: 'create',
        expectedRevision: context.session.revision,
        promptPackageId: prompt.id,
        draftId: draft.id,
        draftWorkingVersion: 1,
      },
      lessonMemory: memory,
    });
    expect(created).toMatchObject({
      invalidated: ['preview'],
      session: {
        confirmedStep: 'create',
        confirmed: {
          create: {
            promptPackageId: prompt.id,
            draftId: draft.id,
            draftWorkingVersion: 1,
            draftStorageUri: 's3://drafts/content/a.md',
            draftHash: 'b'.repeat(64),
          },
        },
      },
    });
  });
});
