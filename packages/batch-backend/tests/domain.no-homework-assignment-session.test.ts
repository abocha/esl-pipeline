import './support/bootstrap-pg-test-env.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
import * as sessions from '../src/domain/assignment-session-repository.js';
import { insertPromptPackage } from '../src/domain/prompt-package-repository.js';
import { updateTranscriptWorkingContent } from '../src/domain/transcript-repository.js';
import { createQueuedTranscriptionRun } from '../src/domain/transcription-run-repository.js';
import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();
const memory = {
  schemaVersion: 'lesson-memory-test-v1',
  provider: 'openai',
  model: 'deterministic-test',
  requestedAt: new Date(),
};
const db = <T>(fn: Parameters<typeof withPgClientSessionContext<T>>[1]) =>
  withPgClientSessionContext({ rlsBypass: true }, fn);

async function source(studentId: string, workspaceId: string) {
  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  await db(async (client) => {
    await client.query(
      `INSERT INTO recordings (id, workspace_id, source, student_id, storage_uri, bytes, status,
      audio_topology, source_identity_kind, source_fingerprint_scheme, source_fingerprint, audio_lifecycle)
      VALUES ($1, $2, 'upload', $3, 'local://recording', 12, 'transcribed', 'trusted_split_channels', 'audio', 'prepared-media-sha256-v1', $4, 'retained')`,
      [recordingId, workspaceId, studentId, recordingId.replaceAll('-', '').repeat(2)],
    );
    await client.query(
      `INSERT INTO transcripts (id, recording_id, storage_uri, working_version, content_hash,
      stt_provider, mode, model, language, fallback_used)
      VALUES ($1, $2, 'local://transcript', 1, $3, 'elevenlabs', 'timeline', 'test', 'auto', false)`,
      [transcriptId, recordingId, 'a'.repeat(64)],
    );
  });
  return {
    lessonId: null,
    recordingId,
    transcriptId,
    transcriptWorkingVersion: 1,
    transcriptHash: 'a'.repeat(64),
  };
}

async function fixture() {
  const userId = randomUUID();
  const studentId = randomUUID();
  const workspaceId = randomUUID();
  await db(async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')`,
      [userId, `${userId}@test.invalid`],
    );
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'no-homework fixture')`, [
      workspaceId,
    ]);
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    await client.query(
      `INSERT INTO students (id, student, workspace_id, profile_provenance) VALUES ($1, 'Test', $2, 'tutor_only')`,
      [studentId, workspaceId],
    );
  });
  const session = await sessions.confirmStudentAssignmentSession({
    userId,
    requestId: randomUUID(),
    studentId,
    lessonId: null,
  });
  const tuple = await source(studentId, workspaceId);
  const attached = await sessions.attachAssignmentSourceCandidate({
    id: session.id,
    userId,
    expectedRevision: session.revision,
    ...tuple,
  });
  const current = await sessions.updateAssignmentSessionRecovery({
    id: session.id,
    userId,
    expectedRevision: attached.session.revision,
    patch: { homeworkIntent: 'none' },
  });
  return { userId, studentId, workspaceId, tuple, session: current };
}

function finish(
  f: Awaited<ReturnType<typeof fixture>>,
  revision = f.session.revision,
  tuple = f.tuple,
) {
  return sessions.finishTranscriptAssignmentSessionPersistence({
    id: f.session.id,
    userId: f.userId,
    request: { expectedRevision: revision, ...tuple },
    lessonMemory: memory,
  });
}

describe('no-homework durable session', () => {
  beforeEach(async () => {
    await db(async (client) => {
      await client.query('TRUNCATE assignment_sessions CASCADE');
    });
  });

  it('saves review without effects, atomically finishes and replays only the current operation', async () => {
    const f = await fixture();
    const before = await db(
      async (client) =>
        (
          await client.query(
            `SELECT (SELECT count(*) FROM lesson_memory_entries WHERE transcript_id=$1) AS memories,
      audio_deletion_requested_at FROM recordings WHERE id=$2`,
            [f.tuple.transcriptId, f.tuple.recordingId],
          )
        ).rows[0],
    );
    expect(before.memories).toBe('0');
    expect(before.audio_deletion_requested_at).toBeNull();
    const result = await finish(f);
    expect(result.session.confirmedStep).toBe('source');
    expect(result.session.transcriptCompletedAt).not.toBeNull();
    expect(result.session.transcriptCompletionHistory).toEqual([
      expect.objectContaining({
        expectedRevision: f.session.revision,
        resultingRevision: result.session.revision,
        studentId: f.studentId,
        source: result.session.confirmed.source,
      }),
    ]);
    const effects = await db(
      async (client) =>
        (
          await client.query(
            `SELECT
      (SELECT count(*) FROM lesson_memory_entries WHERE assignment_session_id=$1) AS memories,
      (SELECT count(*) FROM profile_initial_enrichment_operations WHERE assignment_session_id=$1) AS enrichment,
      (SELECT count(*) FROM prompt_packages WHERE assignment_session_id=$1) AS prompts,
      audio_deletion_requested_at FROM recordings WHERE id=$2`,
            [f.session.id, f.tuple.recordingId],
          )
        ).rows[0],
    );
    expect(effects.memories).toBe('1');
    expect(effects.enrichment).toBe('1');
    expect(effects.prompts).toBe('0');
    expect(effects.audio_deletion_requested_at).not.toBeNull();
    expect((await finish(f)).session).toEqual(result.session);
    await expect(
      finish(f, f.session.revision, { ...f.tuple, transcriptHash: 'b'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT' });
    expect(await sessions.countAssignmentSessionsForUser(f.userId)).toBe(0);
    expect((await sessions.listAssignmentSessionsForUser(f.userId, 20, 'history'))[0]?.id).toBe(
      f.session.id,
    );
  });

  it('rolls back every confirmation effect if completion persistence fails', async () => {
    const f = await fixture();
    await db(async (client) => {
      await client.query(
        `CREATE FUNCTION fail_test_transcript_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.transcript_completed_at IS NOT NULL THEN RAISE EXCEPTION 'injected_finish_failure'; END IF; RETURN NEW; END $$`,
      );
      await client.query(
        `CREATE TRIGGER fail_test_transcript_finish BEFORE UPDATE ON assignment_sessions FOR EACH ROW EXECUTE FUNCTION fail_test_transcript_finish()`,
      );
    });
    try {
      await expect(finish(f)).rejects.toThrow('injected_finish_failure');
    } finally {
      await db(async (client) => {
        await client.query('DROP TRIGGER fail_test_transcript_finish ON assignment_sessions');
        await client.query('DROP FUNCTION fail_test_transcript_finish()');
      });
    }
    const current = await sessions.getAssignmentSessionByIdForUser(f.session.id, f.userId);
    expect(current?.confirmed.source).toBeNull();
    expect(current?.transcriptCompletionHistory).toEqual([]);
    const effects = await db(
      async (client) =>
        (
          await client.query(
            `SELECT (SELECT count(*) FROM lesson_memory_entries WHERE assignment_session_id=$1) AS memories,
      (SELECT count(*) FROM profile_initial_enrichment_operations WHERE assignment_session_id=$1) AS enrichment, audio_deletion_requested_at FROM recordings WHERE id=$2`,
            [f.session.id, f.tuple.recordingId],
          )
        ).rows[0],
    );
    expect(effects.memories).toBe('0');
    expect(effects.enrichment).toBe('0');
    expect(effects.audio_deletion_requested_at).toBeNull();
  });

  it.each(['unchanged', 'edited', 'replaced'] as const)(
    'promotion and %s re-entry retain exact history and require new finish',
    async (variant) => {
      const f = await fixture();
      const completed = (await finish(f)).session;
      const promoted = await sessions.startHomeworkAssignmentSessionPersistence({
        id: f.session.id,
        userId: f.userId,
        expectedRevision: completed.revision,
      });
      expect(promoted.homeworkIntent).toBe('create');
      expect(promoted.transcriptCompletedAt).toBeNull();
      expect(
        (
          await sessions.startHomeworkAssignmentSessionPersistence({
            id: f.session.id,
            userId: f.userId,
            expectedRevision: completed.revision,
          })
        ).revision,
      ).toBe(promoted.revision);
      let current = promoted;
      let tuple = f.tuple;
      if (variant === 'edited') {
        await updateTranscriptWorkingContent({
          id: tuple.transcriptId,
          expectedWorkingVersion: 1,
          storageUri: 'local://edited',
          contentHash: 'b'.repeat(64),
        });
        tuple = { ...tuple, transcriptWorkingVersion: 2, transcriptHash: 'b'.repeat(64) };
      }
      if (variant === 'replaced') {
        tuple = await source(f.studentId, f.workspaceId);
        current = (
          await sessions.attachAssignmentSourceCandidate({
            id: current.id,
            userId: f.userId,
            expectedRevision: current.revision,
            ...tuple,
          })
        ).session;
      }
      current = await sessions.updateAssignmentSessionRecovery({
        id: current.id,
        userId: f.userId,
        expectedRevision: current.revision,
        patch: { homeworkIntent: 'none' },
      });
      expect(current.transcriptCompletedAt).toBeNull();
      expect(current.transcriptCompletionHistory).toEqual(completed.transcriptCompletionHistory);
      expect(await sessions.countAssignmentSessionsForUser(f.userId)).toBe(1);
      await expect(finish(f)).rejects.toMatchObject({
        code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
      });
      const second = (await finish(f, current.revision, tuple)).session;
      expect(second.transcriptCompletionHistory).toHaveLength(2);
      expect(second.transcriptCompletionHistory[0]).toEqual(
        completed.transcriptCompletionHistory[0],
      );
      await expect(
        sessions.startHomeworkAssignmentSessionPersistence({
          id: f.session.id,
          userId: f.userId,
          expectedRevision: completed.revision,
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT' });
      await expect(finish(f)).rejects.toMatchObject({
        code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
      });
    },
  );

  it('rejects all ordinary confirmations under saved none, including identically confirmed Source', async () => {
    const f = await fixture();
    for (const request of [
      { step: 'source' as const, expectedRevision: f.session.revision, ...f.tuple },
      {
        step: 'context' as const,
        expectedRevision: f.session.revision,
        teacherNotes: null,
        profileRevisionId: null,
        profileRevisionHash: null,
      },
      {
        step: 'create' as const,
        expectedRevision: f.session.revision,
        promptPackageId: randomUUID(),
        draftId: randomUUID(),
        draftWorkingVersion: 1,
      },
    ])
      await expect(
        sessions.confirmAssignmentSessionStepPersistence({
          id: f.session.id,
          userId: f.userId,
          request,
          lessonMemory: memory,
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_HOMEWORK_INTENT_CONFLICT' });
    const ordinary = await sessions.updateAssignmentSessionRecovery({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: f.session.revision,
      patch: { homeworkIntent: 'create' },
    });
    const confirmed = await sessions.confirmAssignmentSessionStepPersistence({
      id: f.session.id,
      userId: f.userId,
      request: { step: 'source', expectedRevision: ordinary.revision, ...f.tuple },
      lessonMemory: memory,
    });
    const none = await sessions.updateAssignmentSessionRecovery({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: confirmed.session.revision,
      patch: { homeworkIntent: 'none' },
    });
    await expect(
      sessions.confirmAssignmentSessionStepPersistence({
        id: f.session.id,
        userId: f.userId,
        request: { step: 'source', expectedRevision: none.revision, ...f.tuple },
        lessonMemory: memory,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_HOMEWORK_INTENT_CONFLICT' });
    expect((await finish(f, none.revision)).session.transcriptCompletionHistory).toHaveLength(1);
  });

  it('serializes finish against transcript edits and rejects stale text/mapping writes after completion', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      finish(f),
      updateTranscriptWorkingContent({
        id: f.tuple.transcriptId,
        expectedWorkingVersion: 1,
        storageUri: 'local://racing',
        contentHash: 'b'.repeat(64),
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await sessions.getAssignmentSessionByIdForUser(f.session.id, f.userId);
    if (current?.transcriptCompletedAt) {
      await expect(
        updateTranscriptWorkingContent({
          id: f.tuple.transcriptId,
          expectedWorkingVersion: 1,
          storageUri: 'local://stale',
          contentHash: 'c'.repeat(64),
          summaryJson: { mapping: 'stale' },
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_SESSION_COMPLETED' });
      await expect(
        db((client) =>
          client.query('UPDATE transcripts SET summary_json = $2 WHERE id = $1', [
            f.tuple.transcriptId,
            { stale: true },
          ]),
        ),
      ).rejects.toThrow('assignment_session_completed');
    } else {
      await expect(finish(f)).rejects.toMatchObject({
        code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
      });
    }
  });

  it('completed-source writes, retranscription and same-source reacquisition preserve the completed owner', async () => {
    const f = await fixture();
    const completed = (await finish(f)).session;
    await expect(
      createQueuedTranscriptionRun({
        recordingId: f.tuple.recordingId,
        workspaceId: f.workspaceId,
        provider: 'elevenlabs',
        requestProfile: 'test',
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SESSION_COMPLETED' });
    const fresh = await sessions.confirmStudentAssignmentSession({
      userId: f.userId,
      requestId: randomUUID(),
      studentId: f.studentId,
      lessonId: null,
    });
    const reused = await sessions.attachAssignmentSourceCandidate({
      id: fresh.id,
      userId: f.userId,
      expectedRevision: fresh.revision,
      ...f.tuple,
    });
    expect(reused.outcome).toBe('existing_assignment_resumed');
    expect(reused.session.id).toBe(completed.id);
    expect(reused.session.transcriptCompletedAt).toEqual(completed.transcriptCompletedAt);
    await expect(
      sessions.updateAssignmentSessionRecovery({
        id: completed.id,
        userId: f.userId,
        expectedRevision: completed.revision,
        patch: { homeworkIntent: 'create' },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SESSION_COMPLETED' });
  });

  it('intent switch and ordinary Source confirmation serialize without rejected confirmation effects', async () => {
    const f = await fixture();
    const create = await sessions.updateAssignmentSessionRecovery({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: f.session.revision,
      patch: { homeworkIntent: 'create' },
    });
    const results = await Promise.allSettled([
      sessions.updateAssignmentSessionRecovery({
        id: create.id,
        userId: f.userId,
        expectedRevision: create.revision,
        patch: { homeworkIntent: 'none' },
      }),
      sessions.confirmAssignmentSessionStepPersistence({
        id: create.id,
        userId: f.userId,
        request: { step: 'source', expectedRevision: create.revision, ...f.tuple },
        lessonMemory: memory,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = (await sessions.getAssignmentSessionByIdForUser(create.id, f.userId))!;
    const effects = await db(
      async (client) =>
        (
          await client.query(
            `SELECT count(*) AS n FROM lesson_memory_entries WHERE assignment_session_id=$1`,
            [create.id],
          )
        ).rows[0],
    );
    if (current.homeworkIntent === 'none') {
      expect(current.confirmed.source).toBeNull();
      expect(effects.n).toBe('0');
    } else {
      expect(current.confirmed.source?.transcriptId).toBe(f.tuple.transcriptId);
      expect(effects.n).toBe('1');
    }
  });

  it('none rejects session prompt commits and a prompt-commit race leaves exactly one valid intent', async () => {
    const f = await fixture();
    const insert = () =>
      insertPromptPackage({
        recordingId: f.tuple.recordingId,
        transcriptId: f.tuple.transcriptId,
        assignmentSessionId: f.session.id,
        studentId: f.studentId,
        templateVersion: 'test',
        storageUri: 'local://prompt',
        requestEnvelope: { promptVersion: 'assignment_v1' },
      });
    await expect(insert()).rejects.toThrow('assignment_homework_intent_conflict');
    await expect(
      sessions.reserveAssignmentShare({
        sessionId: f.session.id,
        userId: f.userId,
        expectedRevision: f.session.revision,
        requestId: randomUUID(),
        jobConfig: {} as never,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_HOMEWORK_INTENT_CONFLICT' });
    const create = await sessions.updateAssignmentSessionRecovery({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: f.session.revision,
      patch: { homeworkIntent: 'create' },
    });
    const results = await Promise.allSettled([
      insert(),
      sessions.updateAssignmentSessionRecovery({
        id: create.id,
        userId: f.userId,
        expectedRevision: create.revision,
        patch: { homeworkIntent: 'none' },
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = (await sessions.getAssignmentSessionByIdForUser(create.id, f.userId))!;
    const artifacts = await db(
      async (client) =>
        (
          await client.query(
            'SELECT count(*) AS n FROM prompt_packages WHERE assignment_session_id=$1',
            [create.id],
          )
        ).rows[0],
    );
    if (current.homeworkIntent === 'none') expect(artifacts.n).toBe('0');
    else {
      expect(artifacts.n).toBe('1');
      await expect(
        sessions.updateAssignmentSessionRecovery({
          id: create.id,
          userId: f.userId,
          expectedRevision: current.revision,
          patch: { homeworkIntent: 'none' },
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_HOMEWORK_INTENT_CONFLICT' });
    }
  });

  it('public prompt creation rejects saved none before storage/artifact work for fresh and already-confirmed Source', async () => {
    const f = await fixture();
    const putPromptPackage = vi.fn();
    const insert = vi.fn();
    const request = {
      recordingId: f.tuple.recordingId,
      workspaceId: f.workspaceId,
      assignmentSessionId: f.session.id,
      userId: f.userId,
    };
    const attempt = () =>
      createPromptPackage(request, {
        config: {} as never,
        storage: { putPromptPackage } as never,
        promptPackages: { insert },
      });
    await expect(attempt()).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL' });
    const create = await sessions.updateAssignmentSessionRecovery({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: f.session.revision,
      patch: { homeworkIntent: 'create' },
    });
    const confirmed = await sessions.confirmAssignmentSessionStepPersistence({
      id: f.session.id,
      userId: f.userId,
      request: { step: 'source', expectedRevision: create.revision, ...f.tuple },
      lessonMemory: memory,
    });
    await sessions.updateAssignmentSessionRecovery({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: confirmed.session.revision,
      patch: { homeworkIntent: 'none' },
    });
    await expect(attempt()).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL' });
    expect(putPromptPackage).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    // Standalone prompts retain their existing contract even for the same recording.
    const standalone = await insertPromptPackage({
      recordingId: f.tuple.recordingId,
      transcriptId: f.tuple.transcriptId,
      templateVersion: 'test',
      storageUri: 'local://standalone',
      requestEnvelope: { promptVersion: 'assignment_v1' },
    });
    expect(standalone.assignmentSessionId).toBeNull();
  });

  it('finishes eligible already-confirmed Source without reviving terminal lesson-memory work', async () => {
    const f = await fixture();
    const create = await sessions.updateAssignmentSessionRecovery({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: f.session.revision,
      patch: { homeworkIntent: 'create' },
    });
    const confirmed = await sessions.confirmAssignmentSessionStepPersistence({
      id: create.id,
      userId: f.userId,
      request: { step: 'source', expectedRevision: create.revision, ...f.tuple },
      lessonMemory: memory,
    });
    await db((client) =>
      client.query(
        `UPDATE lesson_memory_entries SET status='failed', generation_notes='{"error":"terminal"}' WHERE id=$1`,
        [confirmed.lessonMemoryIntent!.entryId],
      ),
    );
    const none = await sessions.updateAssignmentSessionRecovery({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: confirmed.session.revision,
      patch: { homeworkIntent: 'none' },
    });
    const result = await finish(f, none.revision);
    expect(result.session.transcriptCompletedAt).not.toBeNull();
    expect(result.lessonMemoryIntent).toBeNull();
    const memoryRow = await db(
      async (client) =>
        (
          await client.query(
            'SELECT status, generation_notes FROM lesson_memory_entries WHERE id=$1',
            [confirmed.lessonMemoryIntent!.entryId],
          )
        ).rows[0],
    );
    expect(memoryRow).toEqual({ status: 'failed', generation_notes: { error: 'terminal' } });
  });

  it('finish races with unchecking and promotion races with stale recovery without overwriting truth', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      finish(f),
      sessions.updateAssignmentSessionRecovery({
        id: f.session.id,
        userId: f.userId,
        expectedRevision: f.session.revision,
        patch: { homeworkIntent: 'create' },
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    let current = (await sessions.getAssignmentSessionByIdForUser(f.session.id, f.userId))!;
    if (!current.transcriptCompletedAt) {
      current = await sessions.updateAssignmentSessionRecovery({
        id: current.id,
        userId: f.userId,
        expectedRevision: current.revision,
        patch: { homeworkIntent: 'none' },
      });
      current = (await finish(f, current.revision)).session;
    }
    const history = current.transcriptCompletionHistory;
    const race = await Promise.allSettled([
      sessions.startHomeworkAssignmentSessionPersistence({
        id: current.id,
        userId: f.userId,
        expectedRevision: current.revision,
      }),
      sessions.updateAssignmentSessionRecovery({
        id: current.id,
        userId: f.userId,
        expectedRevision: current.revision,
        patch: { teacherNotes: 'stale' },
      }),
    ]);
    expect(race[0].status).toBe('fulfilled');
    expect(race[1].status).toBe('rejected');
    current = (await sessions.getAssignmentSessionByIdForUser(f.session.id, f.userId))!;
    expect(current.homeworkIntent).toBe('create');
    expect(current.transcriptCompletedAt).toBeNull();
    expect(current.transcriptCompletionHistory).toEqual(history);
    expect(current.teacherNotes).toBeNull();
  });

  it('migration defaults ordinary rows and enforces immutable history/current-source combinations', async () => {
    const f = await fixture();
    const completed = (await finish(f)).session;
    await expect(
      db((client) =>
        client.query(
          `UPDATE assignment_sessions SET transcript_completion_history='[]' WHERE id=$1`,
          [f.session.id],
        ),
      ),
    ).rejects.toThrow('transcript_completion_history_immutable');
    await expect(
      db((client) =>
        client.query(`UPDATE assignment_sessions SET lesson_id=$2 WHERE id=$1`, [
          f.session.id,
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow();
    const promoted = await sessions.startHomeworkAssignmentSessionPersistence({
      id: f.session.id,
      userId: f.userId,
      expectedRevision: completed.revision,
    });
    await expect(
      db((client) =>
        client.query(`UPDATE assignment_sessions SET transcript_completed_at=$2 WHERE id=$1`, [
          promoted.id,
          completed.transcriptCompletedAt,
        ]),
      ),
    ).rejects.toThrow();
    const fresh = await sessions.confirmStudentAssignmentSession({
      userId: f.userId,
      requestId: randomUUID(),
      studentId: f.studentId,
      lessonId: null,
    });
    expect(fresh.homeworkIntent).toBe('create');
    expect(fresh.transcriptCompletedAt).toBeNull();
    expect(fresh.transcriptCompletionHistory).toEqual([]);
  });
});
