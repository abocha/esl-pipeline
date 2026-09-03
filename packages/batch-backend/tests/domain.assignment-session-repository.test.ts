import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function resetTables() {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('TRUNCATE TABLE assignment_sessions RESTART IDENTITY CASCADE');
  });
}

async function insertUserAndStudent(userId: string, studentId: string) {
  const workspaceId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, 'hash', 'user') ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@example.test`],
    );
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Assignment test')`, [
      workspaceId,
    ]);
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    await client.query(
      `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alpha Tester', $2)`,
      [studentId, workspaceId],
    );
  });
}

async function insertStudentConfirmedSession(params: {
  id: string;
  userId: string;
  studentId: string;
  recordingId?: string;
}) {
  return withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    if (params.recordingId) {
      await client.query(
        `
        INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
        VALUES ($1, 'upload', $2, $3, 12, 'ingested')
        ON CONFLICT (id) DO NOTHING
        `,
        [params.recordingId, params.studentId, `s3://recordings/${params.recordingId}.mp3`],
      );
    }
    return client.query(
      `
      INSERT INTO assignment_sessions (
        id, user_id, student_id, recording_id, revision, confirmed_step, confirmed_snapshot
      )
      VALUES ($1, $2, $3, $4, 1, 'student', $5::jsonb)
      RETURNING revision, confirmed_step, confirmed_snapshot
      `,
      [
        params.id,
        params.userId,
        params.studentId,
        params.recordingId ?? null,
        JSON.stringify({
          student: { studentId: params.studentId },
          source: null,
          context: null,
          create: null,
        }),
      ],
    );
  });
}

async function createMixedSourceConfirmationFixture(params: {
  workingVersion: number;
  contentHash: string;
  mappingWorkingVersion: number;
  mappingContentHash: string;
}) {
  const userId = randomUUID();
  const studentId = randomUUID();
  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  await insertUserAndStudent(userId, studentId);
  const repository = await import('../src/domain/assignment-session-repository.js');
  const session = await repository.confirmStudentAssignmentSession({
    userId,
    requestId: randomUUID(),
    studentId,
    lessonId: null,
  });
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO recordings
         (id, source, student_id, storage_uri, bytes, status, audio_topology)
       VALUES ($1, 'upload', $2, $3, 12, 'transcribed', 'mixed_recording')`,
      [recordingId, studentId, `local://recordings/${recordingId}.mp3`],
    );
    await client.query(
      `INSERT INTO transcripts
         (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
          mode, model, language, fallback_used, summary_json)
       VALUES ($1, $2, $3, $4, $5, 'elevenlabs', 'timeline', 'scribe_v2', 'auto', false, $6::jsonb)`,
      [
        transcriptId,
        recordingId,
        `local://transcripts/${transcriptId}.txt`,
        params.workingVersion,
        params.contentHash,
        JSON.stringify({
          audioTopology: 'mixed_recording',
          speakerTracks: { speakers: [{ speaker: 0 }, { speaker: 1 }] },
          speakerRoleMapping: {
            version: 'speaker-role-mapping-v1',
            provenance: 'tutor_confirmed',
            confidence: null,
            roles: [
              { speaker: 0, role: 'teacher' },
              { speaker: 1, role: 'student' },
            ],
            confirmedWorkingVersion: params.mappingWorkingVersion,
            confirmedContentHash: params.mappingContentHash,
          },
        }),
      ],
    );
  });
  return { userId, recordingId, transcriptId, sessionId: session.id, ...params };
}

async function confirmMixedSource(
  repository: Pick<
    typeof import('../src/domain/assignment-session-repository.js'),
    'confirmAssignmentSessionStepPersistence'
  >,
  fixture: Awaited<ReturnType<typeof createMixedSourceConfirmationFixture>>,
) {
  return repository.confirmAssignmentSessionStepPersistence({
    id: fixture.sessionId,
    userId: fixture.userId,
    request: {
      step: 'source',
      expectedRevision: 1,
      lessonId: null,
      recordingId: fixture.recordingId,
      transcriptId: fixture.transcriptId,
      transcriptWorkingVersion: fixture.workingVersion,
    },
    lessonMemory: {
      schemaVersion: 'lesson-memory-test-v1',
      provider: 'openai',
      model: 'test-model',
      requestedAt: new Date(),
    },
  });
}

describe('domain/assignment-session-repository persistence contract', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('requires the first persisted row to contain a confirmed Student snapshot', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    await insertUserAndStudent(userId, studentId);

    const inserted = await insertStudentConfirmedSession({
      id: randomUUID(),
      userId,
      studentId,
    });

    expect(inserted.rows[0]).toEqual({
      revision: 1,
      confirmed_step: 'student',
      confirmed_snapshot: {
        student: { studentId },
        source: null,
        context: null,
        create: null,
      },
    });
  });

  it('idempotently confirms Student and CAS-updates recovery without stage or archive state', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const requestId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    const { confirmStudentAssignmentSession, updateAssignmentSessionRecovery } = await import(
      '../src/domain/assignment-session-repository.js'
    );

    const created = await confirmStudentAssignmentSession({
      userId,
      requestId,
      studentId,
      lessonId: null,
    });
    const replayed = await confirmStudentAssignmentSession({
      userId,
      requestId,
      studentId,
      lessonId: null,
    });

    expect(replayed.id).toBe(created.id);
    expect(created).toMatchObject({
      revision: 1,
      confirmedStep: 'student',
      confirmed: { student: { studentId }, source: null, context: null, create: null },
    });
    expect(created).not.toHaveProperty('currentStage');
    expect(created).not.toHaveProperty('archivedAt');

    const updated = await updateAssignmentSessionRecovery({
      id: created.id,
      userId,
      expectedRevision: 1,
      patch: { teacherNotes: 'Recovered automatically' },
    });
    expect(updated).toMatchObject({ revision: 2, teacherNotes: 'Recovered automatically' });

    await expect(
      updateAssignmentSessionRecovery({
        id: created.id,
        userId,
        expectedRevision: 1,
        patch: { teacherNotes: 'Stale tab' },
      }),
    ).rejects.toMatchObject({
      code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
      session: expect.objectContaining({ revision: 2, teacherNotes: 'Recovered automatically' }),
    });

    await expect(
      updateAssignmentSessionRecovery({
        id: created.id,
        userId,
        expectedRevision: 2,
        patch: { confirmedStep: 'share' } as never,
      }),
    ).rejects.toThrow('Assignment recovery field is not allowed');
  });

  it('returns the canonical unfinished assignment when source recovery collides', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const canonicalSessionId = randomUUID();
    const newerSessionId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    await insertStudentConfirmedSession({
      id: canonicalSessionId,
      userId,
      studentId,
      recordingId,
    });
    await insertStudentConfirmedSession({ id: newerSessionId, userId, studentId });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, working_version, content_hash, stt_provider)
         VALUES ($1, $2, 'local://transcripts/canonical.txt', 1, $3, 'deepgram')`,
        [transcriptId, recordingId, 'a'.repeat(64)],
      ),
    );
    const { updateAssignmentSessionRecovery } = await import(
      '../src/domain/assignment-session-repository.js'
    );

    await expect(
      updateAssignmentSessionRecovery({
        id: newerSessionId,
        userId,
        expectedRevision: 1,
        patch: { recordingId, transcriptId },
      }),
    ).rejects.toMatchObject({
      code: 'ASSIGNMENT_SOURCE_ALREADY_OWNED',
      session: expect.objectContaining({ id: canonicalSessionId, recordingId }),
    });
  });

  it('rejects Student request-id reuse with different recovery identity', async () => {
    const userId = randomUUID();
    const firstStudentId = randomUUID();
    const secondStudentId = randomUUID();
    const requestId = randomUUID();
    await insertUserAndStudent(userId, firstStudentId);
    await insertUserAndStudent(userId, secondStudentId);
    const { confirmStudentAssignmentSession } = await import(
      '../src/domain/assignment-session-repository.js'
    );

    await confirmStudentAssignmentSession({
      userId,
      requestId,
      studentId: firstStudentId,
      lessonId: null,
    });

    await expect(
      confirmStudentAssignmentSession({
        userId,
        requestId,
        studentId: secondStudentId,
        lessonId: null,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SESSION_REQUEST_CONFLICT' });
  });

  it('atomically reserves one Share job from clean confirmed lineage and replays by stable id', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const draftId = randomUUID();
    const sessionId = randomUUID();
    const requestId = randomUUID();
    const draftUri = `local://drafts/${draftId}/content/confirmed.md`;
    await insertUserAndStudent(userId, studentId);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 'local://recordings/a.opus', 1, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
            mode, model, language, fallback_used)
         VALUES ($1, $2, 'local://transcripts/a.txt', 1, $3, 'deepgram',
                 'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, 'a'.repeat(64)],
      );
      await client.query(
        `INSERT INTO prompt_packages
           (id, recording_id, transcript_id, student_id, template_version, storage_uri)
         VALUES ($1, $2, $3, $4, 'template-v1', 'local://prompts/a.txt')`,
        [promptPackageId, recordingId, transcriptId, studentId],
      );
      await client.query(
        `INSERT INTO drafts
           (id, prompt_package_id, student_id, storage_uri, working_version, content_hash, created_by)
         VALUES ($1, $2, $3, $4, 1, $5, $6)`,
        [draftId, promptPackageId, studentId, draftUri, 'b'.repeat(64), userId],
      );
      await client.query(
        `INSERT INTO assignment_sessions
           (id, user_id, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
            revision, confirmed_step, confirmed_snapshot, teacher_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 4, 'create', $8::jsonb, 'dirty')`,
        [
          sessionId,
          userId,
          studentId,
          recordingId,
          transcriptId,
          promptPackageId,
          draftId,
          JSON.stringify({
            student: { studentId },
            source: {
              lessonId: null,
              recordingId,
              transcriptId,
              transcriptWorkingVersion: 1,
              transcriptStorageUri: 'local://transcripts/a.txt',
              transcriptHash: 'a'.repeat(64),
            },
            context: {
              teacherNotes: null,
              profileId: null,
              profileRevisionId: null,
              profileRevisionHash: null,
            },
            create: {
              promptPackageId,
              draftId,
              draftWorkingVersion: 1,
              draftStorageUri: draftUri,
              draftHash: 'b'.repeat(64),
            },
          }),
        ],
      );
    });
    const { completeAssignmentShare, publishAssignmentCorrectionJob, reserveAssignmentShare } =
      await import('../src/domain/assignment-session-repository.js');

    await expect(
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SHARE_DIRTY_RECOVERY' });

    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query('UPDATE assignment_sessions SET teacher_notes = NULL WHERE id = $1', [
        sessionId,
      ]),
    );
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE transcripts SET storage_uri = 'local://transcripts/b.txt', working_version = 2,
         content_hash = $2 WHERE id = $1`,
        [transcriptId, 'c'.repeat(64)],
      ),
    );
    await expect(
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SHARE_DIRTY_RECOVERY' });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE transcripts SET storage_uri = 'local://transcripts/a.txt', working_version = 1,
         content_hash = $2 WHERE id = $1`,
        [transcriptId, 'a'.repeat(64)],
      ),
    );
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE drafts SET storage_uri = 'local://drafts/working-b.md', working_version = 2,
         content_hash = $2 WHERE id = $1`,
        [draftId, 'd'.repeat(64)],
      ),
    );
    await expect(
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SHARE_DIRTY_RECOVERY' });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE drafts SET storage_uri = $2, working_version = 1,
         content_hash = $3 WHERE id = $1`,
        [draftId, draftUri, 'b'.repeat(64)],
      ),
    );
    const [first, second] = await Promise.all([
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
    ]);
    const reserved = first.created ? first : second;
    const replay = first.created ? second : first;

    expect(reserved).toMatchObject({
      created: true,
      session: { shareJobId: requestId, revision: 5, confirmedStep: 'create' },
      job: { id: requestId, mdStorageUri: draftUri, state: 'awaiting_approval' },
    });
    expect(replay).toMatchObject({ created: false, job: { id: requestId } });
    const {
      approveAssignmentShareJob,
      approveJob,
      updateAssignmentShareJobDraftLink,
      updateJobDraftLink,
    } = await import('../src/domain/job-repository.js');
    await expect(
      updateJobDraftLink({
        id: requestId,
        expectedState: 'awaiting_approval',
        draftId,
        mdStorageUri: 'local://drafts/operator-replacement.md',
      }),
    ).resolves.toBeNull();
    await expect(
      approveJob({
        id: requestId,
        expectedState: 'awaiting_approval',
        mdStorageUri: draftUri,
      }),
    ).resolves.toBeNull();
    await expect(
      updateAssignmentShareJobDraftLink({
        id: requestId,
        sessionId,
        userId,
        expectedState: 'awaiting_approval',
        draftId,
        mdStorageUri: draftUri,
      }),
    ).resolves.toMatchObject({ id: requestId, draftId, mdStorageUri: draftUri });
    await expect(
      approveAssignmentShareJob({
        id: requestId,
        sessionId,
        userId,
        expectedState: 'awaiting_approval',
        mdStorageUri: draftUri,
      }),
    ).resolves.toMatchObject({ id: requestId, state: 'queued' });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(`UPDATE jobs SET state = 'failed' WHERE id = $1`, [requestId]),
    );
    await expect(
      completeAssignmentShare({
        sessionId,
        userId,
        jobId: requestId,
        enqueueSatisfied: false,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID' });
    await expect(
      completeAssignmentShare({
        sessionId,
        userId,
        jobId: requestId,
        enqueueSatisfied: true,
      }),
    ).resolves.toMatchObject({ confirmedStep: 'share', revision: 6 });
    const jobs = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM jobs WHERE id = $1', [
        requestId,
      ]),
    );
    expect(jobs.rows[0]?.count).toBe('1');
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE jobs
         SET state = 'succeeded', html_url = 'https://example.test/share',
             manifest_path = 's3://manifests/share.json'
         WHERE id = $1`,
        [requestId],
      ),
    );

    for (const correctionFirst of [false, true]) {
      const correctionRequest = {
        requestId: randomUUID(),
        draftId,
        draftWorkingVersion: 1,
        draftHash: 'b'.repeat(64),
      };
      const shareReplay = () =>
        reserveAssignmentShare({
          sessionId,
          userId,
          expectedRevision: 6,
          requestId,
          jobConfig: { publishTarget: 'html', upload: 'auto' },
        });
      const correction = () =>
        publishAssignmentCorrectionJob({
          userId,
          publishedJobId: requestId,
          request: correctionRequest,
        });
      const [share, correctionChild] = correctionFirst
        ? await Promise.all([correction(), shareReplay()]).then(([child, replay]) => [
            replay,
            child,
          ])
        : await Promise.all([shareReplay(), correction()]);

      expect(share).toMatchObject({ created: false, job: { id: requestId } });
      expect(correctionChild).toMatchObject({
        created: true,
        job: { id: correctionRequest.requestId, sourceJobId: requestId, state: 'queued' },
      });
    }
  });

  it('creates one queued correction child from a terminal Share snapshot and rejects mismatched replays', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const draftId = randomUUID();
    const parentId = randomUUID();
    const requestId = randomUUID();
    const draftHash = 'b'.repeat(64);
    const draftUri = `local://drafts/${draftId}/content/${draftHash}.md`;
    await insertUserAndStudent(userId, studentId);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 'local://recordings/a.opus', 1, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
            mode, model, language, fallback_used)
         VALUES ($1, $2, 'local://transcripts/a.txt', 1, $3, 'deepgram',
                 'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, 'a'.repeat(64)],
      );
      await client.query(
        `INSERT INTO prompt_packages
           (id, recording_id, transcript_id, student_id, template_version, storage_uri)
         VALUES ($1, $2, $3, $4, 'template-v1', 'local://prompts/a.txt')`,
        [promptPackageId, recordingId, transcriptId, studentId],
      );
      await client.query(
        `INSERT INTO drafts
           (id, prompt_package_id, student_id, storage_uri, working_version, content_hash, created_by)
         VALUES ($1, $2, $3, $4, 3, $5, $6)`,
        [draftId, promptPackageId, studentId, draftUri, draftHash, userId],
      );
      await client.query(
        `INSERT INTO jobs
           (id, state, md_storage_uri, recording_id, transcript_id, prompt_package_id, draft_id,
            student_id, user_id, preset, with_tts, upload, publish_target, html_url, manifest_path)
         VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, $8, 'b1-default', true,
                 's3', 'html', 'https://example.test/parent', 's3://manifests/parent.json')`,
        [
          parentId,
          draftUri,
          recordingId,
          transcriptId,
          promptPackageId,
          draftId,
          studentId,
          userId,
        ],
      );
      await client.query(
        `INSERT INTO assignment_sessions
           (id, user_id, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
            revision, confirmed_step, confirmed_snapshot, share_job_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 6, 'share', $8::jsonb, $9)`,
        [
          randomUUID(),
          userId,
          studentId,
          recordingId,
          transcriptId,
          promptPackageId,
          draftId,
          JSON.stringify({
            student: { studentId },
            source: {
              lessonId: null,
              recordingId,
              transcriptId,
              transcriptWorkingVersion: 1,
              transcriptStorageUri: 'local://transcripts/a.txt',
              transcriptHash: 'a'.repeat(64),
            },
            context: {
              teacherNotes: null,
              profileId: null,
              profileRevisionId: null,
              profileRevisionHash: null,
            },
            create: {
              promptPackageId,
              draftId,
              draftWorkingVersion: 1,
              draftStorageUri: 'local://drafts/original/content/original.md',
              draftHash: 'c'.repeat(64),
            },
          }),
          parentId,
        ],
      );
    });
    const { publishAssignmentCorrectionJob } = await import(
      '../src/domain/assignment-session-repository.js'
    );
    const request = { requestId, draftId, draftWorkingVersion: 3, draftHash };

    const [first, second] = await Promise.all([
      publishAssignmentCorrectionJob({ userId, publishedJobId: parentId, request }),
      publishAssignmentCorrectionJob({ userId, publishedJobId: parentId, request }),
    ]);
    const created = first.created ? first : second;
    const replay = first.created ? second : first;

    expect(created).toMatchObject({
      created: true,
      job: {
        id: requestId,
        state: 'queued',
        sourceJobId: parentId,
        draftId,
        md: null,
        mdStorageUri: draftUri,
        htmlUrl: null,
        manifestPath: null,
      },
    });
    expect(replay).toMatchObject({ created: false, job: { id: requestId } });
    await expect(
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: { ...request, draftHash: 'd'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_CORRECTION_REQUEST_CONFLICT' });
    await expect(
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: { ...request, draftWorkingVersion: 4 },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_CORRECTION_REQUEST_CONFLICT' });
    const competingRequest = { ...request, requestId: randomUUID() };
    const competing = await Promise.allSettled([
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: competingRequest,
      }),
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: { ...competingRequest, draftWorkingVersion: 4 },
      }),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE jobs
         SET state = 'failed', error = 'pipeline failed', started_at = NOW(), finished_at = NOW(),
             manifest_path = 's3://manifests/partial-child.json', html_url = 'https://example.test/child'
         WHERE id = $1`,
        [requestId],
      ),
    );
    const resetReplays = await Promise.all([
      publishAssignmentCorrectionJob({ userId, publishedJobId: parentId, request }),
      publishAssignmentCorrectionJob({ userId, publishedJobId: parentId, request }),
    ]);
    for (const resetReplay of resetReplays) {
      expect(resetReplay).toMatchObject({
        created: false,
        job: {
          id: requestId,
          state: 'queued',
          sourceJobId: parentId,
          draftId,
          mdStorageUri: draftUri,
          error: null,
          startedAt: null,
          finishedAt: null,
          manifestPath: null,
          htmlUrl: null,
        },
      });
    }
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(`UPDATE jobs SET state = 'failed' WHERE id = $1`, [requestId]),
    );
    await expect(
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: { ...request, draftHash: 'd'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_CORRECTION_REQUEST_CONFLICT' });
    await expect(
      withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query<{ state: string }>(`SELECT state FROM jobs WHERE id = $1`, [requestId]),
      ),
    ).resolves.toMatchObject({ rows: [{ state: 'failed' }] });
    await expect(
      withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query(`SELECT html_url, manifest_path FROM jobs WHERE id = $1`, [parentId]),
      ),
    ).resolves.toMatchObject({
      rows: [
        { html_url: 'https://example.test/parent', manifest_path: 's3://manifests/parent.json' },
      ],
    });
  });

  it('keeps completed Share readable but out of resume, counts, and active-recording reuse', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const shareJobId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    const repository = await import('../src/domain/assignment-session-repository.js');

    const completed = await repository.confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, $3, 12, 'ingested')`,
        [recordingId, studentId, `s3://recordings/${recordingId}.mp3`],
      );
      await client.query(
        `INSERT INTO jobs (id, state, student_id, user_id) VALUES ($1, 'succeeded', $2, $3)`,
        [shareJobId, studentId, userId],
      );
      await client.query(
        `UPDATE assignment_sessions
         SET recording_id = $2, confirmed_step = 'share', share_job_id = $3, revision = revision + 1
         WHERE id = $1`,
        [completed.id, recordingId, shareJobId],
      );
    });

    await expect(repository.listAssignmentSessionsForUser(userId, 20)).resolves.toEqual([]);
    await expect(repository.countAssignmentSessionsForUser(userId)).resolves.toBe(0);
    await expect(
      repository.getAssignmentSessionByIdForUser(completed.id, userId),
    ).resolves.toMatchObject({
      id: completed.id,
      confirmedStep: 'share',
    });

    const next = await repository.confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    await expect(
      repository.updateAssignmentSessionRecovery({
        id: next.id,
        userId,
        expectedRevision: 1,
        patch: { recordingId },
      }),
    ).resolves.toMatchObject({ id: next.id, recordingId });
    await expect(
      repository.getActiveAssignmentSessionByRecording(userId, recordingId),
    ).resolves.toMatchObject({ id: next.id });
  });

  it('fails closed when confirmed snapshot JSON is structurally malformed', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const sessionId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO assignment_sessions (
           id, user_id, student_id, revision, confirmed_step, confirmed_snapshot
         ) VALUES ($1, $2, $3, 1, 'source', $4::jsonb)`,
        [
          sessionId,
          userId,
          studentId,
          JSON.stringify({
            student: { studentId },
            source: {},
            context: null,
            create: null,
          }),
        ],
      );
    });
    const { getAssignmentSessionByIdForUser } = await import(
      '../src/domain/assignment-session-repository.js'
    );

    await expect(getAssignmentSessionByIdForUser(sessionId, userId)).rejects.toMatchObject({
      name: 'ZodError',
    });
  });

  it('treats confirmed Share as the active-session uniqueness boundary', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const firstSessionId = randomUUID();
    const shareJobId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    await insertStudentConfirmedSession({
      id: firstSessionId,
      userId,
      studentId,
      recordingId,
    });

    await expect(
      insertStudentConfirmedSession({
        id: randomUUID(),
        userId,
        studentId,
        recordingId,
      }),
    ).rejects.toMatchObject({ code: '23505' });

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO jobs (id, state, student_id, user_id) VALUES ($1, 'succeeded', $2, $3)`,
        [shareJobId, studentId, userId],
      );
      await client.query(
        `
        UPDATE assignment_sessions
        SET confirmed_step = 'share', share_job_id = $2, revision = revision + 1
        WHERE id = $1
        `,
        [firstSessionId, shareJobId],
      );
    });

    await expect(
      insertStudentConfirmedSession({
        id: randomUUID(),
        userId,
        studentId,
        recordingId,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects completed Share without the stable linked job', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const sessionId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    await insertStudentConfirmedSession({ id: sessionId, userId, studentId });

    await expect(
      withPgClientSessionContext({ rlsBypass: true }, async (client) =>
        client.query(`UPDATE assignment_sessions SET confirmed_step = 'share' WHERE id = $1`, [
          sessionId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects invalid revisions, steps, and malformed confirmed snapshots', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    await insertUserAndStudent(userId, studentId);

    await expect(
      withPgClientSessionContext({ rlsBypass: true }, async (client) =>
        client.query(
          `
          INSERT INTO assignment_sessions (
            id, user_id, student_id, revision, confirmed_step, confirmed_snapshot
          )
          VALUES ($1, $2, $3, 0, 'unknown', '{}'::jsonb)
          `,
          [randomUUID(), userId, studentId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('defines every resumable-session index from confirmed Share completion', async () => {
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const indexes = await client.query<{ indexname: string; indexdef: string }>(
        `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_assignment_sessions_user_active_recording',
            'idx_assignment_sessions_user_active_updated',
            'idx_assignment_sessions_lesson_updated'
          )
        ORDER BY indexname
        `,
      );

      expect(indexes.rows).toHaveLength(3);
      for (const index of indexes.rows) {
        expect(index.indexdef).toContain("confirmed_step <> 'share'::text");
        expect(index.indexdef).not.toContain('archived_at');
      }
    });
  });

  it('accepts source confirmation when the tutor mapping binds the current transcript state', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 2,
      contentHash: 'b'.repeat(64),
      mappingWorkingVersion: 2,
      mappingContentHash: 'b'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');

    await expect(confirmMixedSource(repository, fixture)).resolves.toMatchObject({
      session: { confirmedStep: 'source' },
    });
  });

  it('rejects stale mappings until the tutor reconfirms them for the current transcript state', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 3,
      contentHash: 'c'.repeat(64),
      mappingWorkingVersion: 2,
      mappingContentHash: 'b'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');

    await expect(confirmMixedSource(repository, fixture)).rejects.toMatchObject({
      code: 'ASSIGNMENT_STEP_SPEAKER_ROLE_MAPPING_REQUIRED',
    });

    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE transcripts
         SET summary_json = jsonb_set(
           summary_json,
           '{speakerRoleMapping}',
           $2::jsonb
         )
         WHERE id = $1`,
        [
          fixture.transcriptId,
          JSON.stringify({
            version: 'speaker-role-mapping-v1',
            provenance: 'tutor_confirmed',
            confidence: null,
            roles: [
              { speaker: 0, role: 'teacher' },
              { speaker: 1, role: 'student' },
            ],
            confirmedWorkingVersion: 3,
            confirmedContentHash: 'c'.repeat(64),
          }),
        ],
      ),
    );

    await expect(confirmMixedSource(repository, fixture)).resolves.toMatchObject({
      session: { confirmedStep: 'source' },
    });
  });

  it('keys lesson-memory intent by transcript and confirmed source hash', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const sourceHash = 'a'.repeat(64);
    await insertUserAndStudent(userId, studentId);

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `
        INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
        VALUES ($1, 'upload', $2, 's3://recordings/memory.mp3', 12, 'ingested')
        `,
        [recordingId, studentId],
      );
      await client.query(
        `
        INSERT INTO transcripts (id, recording_id, storage_uri, stt_provider)
        VALUES ($1, $2, 's3://transcripts/memory.json', 'deepgram')
        `,
        [transcriptId, recordingId],
      );

      const insertMemory = () =>
        client.query(
          `
          INSERT INTO lesson_memory_entries (
            id, student_id, transcript_id, recording_id, schema_version, generated_at,
            provider, model, status, source_storage_uri, source_content_hash
          )
          VALUES ($1, $2, $3, $4, '1', NOW(), 'openai', 'gpt-5.6', 'pending', $5, $6)
          `,
          [
            randomUUID(),
            studentId,
            transcriptId,
            recordingId,
            's3://confirmed-transcripts/a.json',
            sourceHash,
          ],
        );

      await insertMemory();
      await expect(insertMemory()).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('rejects partial working and confirmed-source provenance pairs', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    await insertUserAndStudent(userId, studentId);

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const expectCheckViolation = async (query: () => Promise<unknown>) => {
        await client.query('SAVEPOINT expected_check_violation');
        await expect(query()).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT expected_check_violation');
        await client.query('RELEASE SAVEPOINT expected_check_violation');
      };

      await client.query(
        `
        INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
        VALUES ($1, 'upload', $2, 's3://recordings/provenance.mp3', 12, 'ingested')
        `,
        [recordingId, studentId],
      );
      await client.query(
        `
        INSERT INTO transcripts (id, recording_id, storage_uri, stt_provider)
        VALUES ($1, $2, 's3://transcripts/provenance.json', 'deepgram')
        `,
        [transcriptId, recordingId],
      );

      await expectCheckViolation(() =>
        client.query(`UPDATE transcripts SET working_version = 1 WHERE id = $1`, [transcriptId]),
      );
      await expectCheckViolation(() =>
        client.query(`UPDATE transcripts SET content_hash = $2 WHERE id = $1`, [
          transcriptId,
          'b'.repeat(64),
        ]),
      );

      const insertMemory = (sourceStorageUri: string | null, sourceContentHash: string | null) =>
        client.query(
          `
          INSERT INTO lesson_memory_entries (
            id, student_id, transcript_id, recording_id, schema_version, generated_at,
            provider, model, status, source_storage_uri, source_content_hash
          )
          VALUES ($1, $2, $3, $4, '1', NOW(), 'openai', 'gpt-5.6', 'pending', $5, $6)
          `,
          [randomUUID(), studentId, transcriptId, recordingId, sourceStorageUri, sourceContentHash],
        );

      await expectCheckViolation(() =>
        insertMemory('s3://confirmed-transcripts/partial.json', null),
      );
      await expectCheckViolation(() => insertMemory(null, 'c'.repeat(64)));
    });
  });
});
