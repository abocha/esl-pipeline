import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { manifestPathFor } from '@esl-pipeline/orchestrator';

vi.mock('../src/infrastructure/queue-bullmq.js', () => ({
  createJobQueue: vi.fn(() => ({ enqueue: vi.fn().mockResolvedValue(undefined) })),
}));

import { getJobProvenance } from '../src/application/get-job-provenance.js';
import { getJobStatus } from '../src/application/get-job-status.js';
import { rerun } from '../src/application/job-actions/rerun.js';
import { jobRecordToDto } from '../src/application/job-dto.js';
import { retryRecordingTranscription } from '../src/application/retry-recording-transcription.js';
import {
  confirmAssignmentSessionStepPersistence,
  confirmStudentAssignmentSession,
  updateAssignmentSessionRecovery,
} from '../src/domain/assignment-session-repository.js';
import { insertJobActionHistory } from '../src/domain/job-action-history-repository.js';
import { JobActionType } from '../src/domain/job-actions.js';
import { publishJobEvent } from '../src/domain/job-events.js';
import type { JobRecord } from '../src/domain/job-model.js';
import { getJobById, getJobWorkspaceAuthority } from '../src/domain/job-repository.js';
import {
  getRecordingByIdForWorkspace,
  insertRecording,
  listRecordingsBySha256ForWorkspace,
} from '../src/domain/recording-repository.js';
import { getStudentById } from '../src/domain/student-repository.js';
import {
  getTranscriptByRecordingIdForWorkspace,
  insertTranscript,
} from '../src/domain/transcript-repository.js';
import { createPgPool, withPgClientSessionContext } from '../src/infrastructure/db.js';
import type { AuthenticatedRequest } from '../src/transport/auth-middleware.js';
import { registerCoreRoutes } from '../src/transport/core-routes.js';

describe('recording tenant authority', () => {
  beforeEach(async () => {
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `TRUNCATE TABLE assignment_sessions, transcripts, transcription_runs,
         recordings, students, workspace_memberships, workspaces, users RESTART IDENTITY CASCADE`,
      ),
    );
  });

  it('denies cross-workspace recording, transcript, cache, retry, and confirmation access', async () => {
    const tenantA = await seedTenant('Tutor A');
    const tenantB = await seedTenant('Tutor B');
    const sha256 = 'a'.repeat(64);
    const recordingA = await insertRecording({
      workspaceId: tenantA.workspaceId,
      source: 'upload',
      studentId: tenantA.studentId,
      sourcePath: 'lesson.mp3',
      storageUri: 'local://recordings/a.mp3',
      sha256,
      bytes: 10,
      audioTopology: 'mixed_recording',
      status: 'failed',
    });
    const recordingB = await insertRecording({
      workspaceId: tenantB.workspaceId,
      source: 'upload',
      studentId: tenantB.studentId,
      sourcePath: 'lesson.mp3',
      storageUri: 'local://recordings/b.mp3',
      sha256,
      bytes: 10,
      audioTopology: 'mixed_recording',
      status: 'transcribed',
    });
    const transcriptB = await insertTranscript({
      recordingId: recordingB.id,
      storageUri: 'local://transcripts/b.txt',
      workingVersion: 1,
      contentHash: 'b'.repeat(64),
      rawResponseUri: 'local://transcripts/b.raw.json',
      mode: 'timeline',
      model: 'scribe_v2',
      language: 'auto',
      sttProvider: 'elevenlabs',
      fallbackUsed: false,
    });

    expect(
      await getStudentById(tenantB.studentId, { workspaceId: tenantA.workspaceId }),
    ).toBeNull();
    expect(await getRecordingByIdForWorkspace(recordingB.id, tenantA.workspaceId)).toBeNull();
    expect(
      await getTranscriptByRecordingIdForWorkspace(recordingB.id, tenantA.workspaceId),
    ).toBeNull();
    expect(
      (await listRecordingsBySha256ForWorkspace(sha256, tenantA.workspaceId)).map((r) => r.id),
    ).toEqual([recordingA.id]);

    const enqueue = vi.fn();
    const updateStatus = vi.fn();
    expect(
      await retryRecordingTranscription(
        recordingA.id,
        { workspaceId: tenantB.workspaceId },
        {
          recordings: {
            getById: getRecordingByIdForWorkspace,
            updateStatus,
          },
          enqueue,
          publishEvent: vi.fn(),
        },
      ),
    ).toBeNull();
    expect(updateStatus).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    const session = await confirmStudentAssignmentSession({
      userId: tenantA.userId,
      requestId: randomUUID(),
      studentId: tenantA.studentId,
      lessonId: null,
    });
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: session.id,
        userId: tenantA.userId,
        request: {
          step: 'source',
          expectedRevision: session.revision,
          lessonId: null,
          recordingId: recordingB.id,
          transcriptId: transcriptB.id,
          transcriptWorkingVersion: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND' });
  });

  it('rejects mixed-workspace job lineage before authenticated job materialization', async () => {
    const tenantA = await seedTenant('Tutor A');
    const tenantB = await seedTenant('Tutor B');
    const lineageA = await seedJobLineage(tenantA, 'a');
    const lineageB = await seedJobLineage(tenantB, 'b');
    const jobId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `INSERT INTO jobs (
           id, state, student_id, recording_id, transcript_id, prompt_package_id, draft_id
         ) VALUES ($1, 'succeeded', $2, $3, $4, $5, $6)`,
        [
          jobId,
          tenantA.studentId,
          lineageA.recordingId,
          lineageA.transcriptId,
          lineageA.promptPackageId,
          lineageA.draftId,
        ],
      ),
    );

    await expect(
      getJobWorkspaceAuthority(jobId, tenantA.workspaceId, tenantA.userId),
    ).resolves.toEqual({
      mode: 'recording_backed',
      recordingId: lineageA.recordingId,
    });

    for (const [column, foreignId] of [
      ['transcript_id', lineageB.transcriptId],
      ['prompt_package_id', lineageB.promptPackageId],
      ['draft_id', lineageB.draftId],
    ] as const) {
      await withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query(`UPDATE jobs SET ${column} = $2 WHERE id = $1`, [jobId, foreignId]),
      );
      await expect(
        getJobWorkspaceAuthority(jobId, tenantA.workspaceId, tenantA.userId),
      ).resolves.toBeNull();
      await withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query(
          `UPDATE jobs
           SET transcript_id = $2, prompt_package_id = $3, draft_id = $4
           WHERE id = $1`,
          [jobId, lineageA.transcriptId, lineageA.promptPackageId, lineageA.draftId],
        ),
      );
    }

    const sourceJobId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `INSERT INTO jobs (id, state, student_id, recording_id, transcript_id)
         VALUES ($1, 'succeeded', $2, $3, $4)`,
        [sourceJobId, tenantB.studentId, lineageB.recordingId, lineageB.transcriptId],
      ),
    );
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(`UPDATE jobs SET source_job_id = $2 WHERE id = $1`, [jobId, sourceJobId]),
    );
    await expect(
      getJobWorkspaceAuthority(jobId, tenantA.workspaceId, tenantA.userId),
    ).resolves.toBeNull();

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(`UPDATE jobs SET source_job_id = NULL WHERE id = $1`, [jobId]);
      await client.query(
        `INSERT INTO job_action_history (
           id, job_id, action_type, requested_at, outcome, message, created_job_id
         ) VALUES ($1, $2, 'rerun', NOW(), 'succeeded', 'foreign edge', $3)`,
        [randomUUID(), jobId, sourceJobId],
      );
    });
    await expect(
      getJobWorkspaceAuthority(jobId, tenantA.workspaceId, tenantA.userId),
    ).resolves.toBeNull();
  });

  it('persists owner authority for the authenticated standalone job lifecycle', async () => {
    const tenantA = await seedTenant('Tutor A');
    const tenantB = await seedTenant('Tutor B');
    const foreignLineage = await seedJobLineage(tenantB, 'b');
    const workdir = await mkdtemp(path.join(tmpdir(), 'standalone-job-authority-'));
    const markdownPath = path.join(workdir, 'assignment.md');
    await writeFile(markdownPath, '# Standalone assignment', 'utf8');
    await writeFile(
      manifestPathFor(markdownPath),
      JSON.stringify({
        schemaVersion: 3,
        mdHash: 'standalone-test-hash',
        publishTarget: 'html',
        timestamp: '2026-09-03T00:00:00.000Z',
      }),
      'utf8',
    );
    const appA = createCoreAppForTenant(tenantA);
    const appB = createCoreAppForTenant(tenantB);

    try {
      const submitted = await appA.inject({
        method: 'POST',
        url: '/jobs',
        payload: { md: markdownPath },
      });
      expect(submitted.statusCode).toBe(202);
      const { jobId } = submitted.json<{ jobId: string }>();
      await expect(getJobById(jobId)).resolves.toMatchObject({
        userId: tenantA.userId,
        recordingId: null,
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
      });
      await expect(
        getJobWorkspaceAuthority(jobId, tenantA.workspaceId, tenantA.userId),
      ).resolves.toEqual({ mode: 'standalone_owner', recordingId: null });
      await expect(
        getJobWorkspaceAuthority(jobId, tenantB.workspaceId, tenantB.userId),
      ).resolves.toBeNull();

      const ownStatus = await appA.inject({ method: 'GET', url: `/jobs/${jobId}` });
      expect(ownStatus.statusCode).toBe(200);
      const ownProvenance = await appA.inject({
        method: 'GET',
        url: `/jobs/${jobId}/provenance`,
      });
      expect(ownProvenance.statusCode).toBe(200);
      expect(ownProvenance.json()).toMatchObject({
        job: { id: jobId },
        recording: null,
        transcript: null,
        promptPackage: null,
        draft: null,
      });

      const absentId = randomUUID();
      for (const url of [`/jobs/${jobId}`, `/jobs/${jobId}/provenance`]) {
        const foreign = await appB.inject({ method: 'GET', url });
        const absent = await appB.inject({
          method: 'GET',
          url: url.replace(jobId, absentId),
        });
        expect({ statusCode: foreign.statusCode, body: foreign.json() }).toEqual({
          statusCode: absent.statusCode,
          body: absent.json(),
        });
      }
      const foreignSse = await appB.inject({
        method: 'GET',
        url: `/jobs/events?jobId=${jobId}`,
      });
      const absentSse = await appB.inject({
        method: 'GET',
        url: `/jobs/events?jobId=${absentId}`,
      });
      expect({ statusCode: foreignSse.statusCode, body: foreignSse.json() }).toEqual({
        statusCode: absentSse.statusCode,
        body: absentSse.json(),
      });

      const standalone = await getJobById(jobId);
      expect(standalone).not.toBeNull();
      const ssePayload = await captureTargetedJobEvent(appA, standalone!);
      expect(ssePayload).toContain(`\"jobId\":\"${jobId}\"`);

      await withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query(`UPDATE jobs SET state = 'succeeded', finished_at = NOW() WHERE id = $1`, [
          jobId,
        ]),
      );
      const rerunResult = await rerun(jobId, {
        type: JobActionType.RERUN,
        requestedAt: new Date('2026-09-03T00:05:00.000Z'),
        requestedBy: tenantA.userId,
        payload: { republishOnly: true },
      });
      expect(rerunResult.success).toBe(true);
      const childId = rerunResult.jobId;
      await expect(getJobById(childId)).resolves.toMatchObject({
        userId: tenantA.userId,
        recordingId: null,
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
        sourceJobId: jobId,
      });

      for (const id of [jobId, childId]) {
        await expect(
          getJobWorkspaceAuthority(id, tenantA.workspaceId, tenantA.userId),
        ).resolves.toEqual({ mode: 'standalone_owner', recordingId: null });
        await expect(
          getJobWorkspaceAuthority(id, tenantB.workspaceId, tenantB.userId),
        ).resolves.toBeNull();
      }

      await insertJobActionHistory({
        jobId,
        actionType: JobActionType.RERUN,
        payload: { republishOnly: true },
        requestedAt: new Date('2026-09-03T00:05:00.000Z'),
        requestedBy: tenantA.userId,
        outcome: 'succeeded',
        message: 'Republish queued',
        createdJobId: childId,
      });

      for (const id of [jobId, childId]) {
        await expect(
          getJobWorkspaceAuthority(id, tenantA.workspaceId, tenantA.userId),
        ).resolves.toEqual({ mode: 'standalone_owner', recordingId: null });
        expect((await appA.inject({ method: 'GET', url: `/jobs/${id}` })).statusCode).toBe(200);
        expect(
          (await appA.inject({ method: 'GET', url: `/jobs/${id}/provenance` })).statusCode,
        ).toBe(200);
        expect((await appB.inject({ method: 'GET', url: `/jobs/${id}` })).statusCode).toBe(404);
      }

      await withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query(`UPDATE jobs SET transcript_id = $2 WHERE id = $1`, [
          childId,
          foreignLineage.transcriptId,
        ]),
      );
      await expect(
        getJobWorkspaceAuthority(childId, tenantA.workspaceId, tenantA.userId),
      ).resolves.toBeNull();
      await expect(
        getJobWorkspaceAuthority(jobId, tenantA.workspaceId, tenantA.userId),
      ).resolves.toBeNull();
      expect((await appA.inject({ method: 'GET', url: `/jobs/${childId}` })).statusCode).toBe(404);
    } finally {
      await appA.close();
      await appB.close();
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('keeps a persisted rerun parent and child workspace-authorizable before and after action history', async () => {
    const tenantA = await seedTenant('Tutor A');
    const tenantB = await seedTenant('Tutor B');
    const lineageA = await seedJobLineage(tenantA, 'a');
    const parentId = randomUUID();
    const workdir = await mkdtemp(path.join(tmpdir(), 'rerun-workspace-authority-'));
    const markdownPath = path.join(workdir, 'assignment.md');
    await writeFile(markdownPath, '# Assignment', 'utf8');
    await writeFile(
      manifestPathFor(markdownPath),
      JSON.stringify({
        schemaVersion: 3,
        mdHash: 'test-hash',
        publishTarget: 'html',
        timestamp: '2026-09-03T00:00:00.000Z',
      }),
      'utf8',
    );

    try {
      await withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query(
          `INSERT INTO jobs (
             id, state, md, student_id, recording_id, transcript_id,
             prompt_package_id, draft_id, publish_target, user_id
           ) VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, 'html', $8)`,
          [
            parentId,
            markdownPath,
            tenantA.studentId,
            lineageA.recordingId,
            lineageA.transcriptId,
            lineageA.promptPackageId,
            lineageA.draftId,
            tenantA.userId,
          ],
        ),
      );

      const result = await rerun(parentId, {
        type: JobActionType.RERUN,
        requestedAt: new Date('2026-09-03T00:00:00.000Z'),
        requestedBy: tenantA.userId,
        payload: { republishOnly: true },
      });
      expect(result).toMatchObject({ success: true, actionType: JobActionType.RERUN });
      const childId = result.jobId;
      const child = await getJobById(childId);
      expect(child).toMatchObject({
        recordingId: lineageA.recordingId,
        transcriptId: lineageA.transcriptId,
        promptPackageId: lineageA.promptPackageId,
        draftId: lineageA.draftId,
        sourceJobId: parentId,
      });

      await expect(
        getJobWorkspaceAuthority(childId, tenantA.workspaceId, tenantA.userId),
      ).resolves.toEqual({
        mode: 'recording_backed',
        recordingId: lineageA.recordingId,
      });
      await expect(
        getJobWorkspaceAuthority(parentId, tenantA.workspaceId, tenantA.userId),
      ).resolves.toEqual({
        mode: 'recording_backed',
        recordingId: lineageA.recordingId,
      });

      await insertJobActionHistory({
        jobId: parentId,
        actionType: JobActionType.RERUN,
        payload: { republishOnly: true },
        requestedAt: new Date('2026-09-03T00:00:00.000Z'),
        requestedBy: tenantA.userId,
        outcome: 'succeeded',
        message: 'Republish queued',
        createdJobId: childId,
      });

      const app = Fastify();
      registerCoreRoutes(app, {
        config: {} as never,
        authenticate: async (request) => {
          (request as AuthenticatedRequest).user = {
            id: tenantA.userId,
            email: `${tenantA.userId}@example.test`,
            role: 'user',
          };
        },
      });
      try {
        for (const jobId of [parentId, childId]) {
          await expect(
            getJobWorkspaceAuthority(jobId, tenantA.workspaceId, tenantA.userId),
          ).resolves.toEqual({
            mode: 'recording_backed',
            recordingId: lineageA.recordingId,
          });
          await expect(
            getJobWorkspaceAuthority(jobId, tenantB.workspaceId, tenantB.userId),
          ).resolves.toBeNull();
          await expect(getJobStatus(jobId)).resolves.toMatchObject({ jobId });
          await expect(
            getJobProvenance(jobId, tenantA.workspaceId, tenantA.userId),
          ).resolves.toMatchObject({
            job: { id: jobId },
            recording: { id: lineageA.recordingId },
          });
          await expect(app.inject({ method: 'GET', url: `/jobs/${jobId}` })).resolves.toMatchObject(
            { statusCode: 200 },
          );
          await expect(
            app.inject({ method: 'GET', url: `/jobs/${jobId}/provenance` }),
          ).resolves.toMatchObject({ statusCode: 200 });
        }
        expect(jobRecordToDto(child!).jobId).toBe(childId);
      } finally {
        await app.close();
      }
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('validates prompt packages even without drafts and never mutates recovery on foreign lineage', async () => {
    const tenantA = await seedTenant('Tutor A');
    const tenantB = await seedTenant('Tutor B');
    const lineageA = await seedJobLineage(tenantA, 'a');
    const lineageB = await seedJobLineage(tenantB, 'b');
    const session = await confirmStudentAssignmentSession({
      userId: tenantA.userId,
      requestId: randomUUID(),
      studentId: tenantA.studentId,
      lessonId: null,
    });

    for (const [promptPackageId, draftId] of [
      [lineageB.promptPackageId, null],
      [randomUUID(), null],
      [lineageB.promptPackageId, lineageB.draftId],
      [lineageB.promptPackageId, lineageA.draftId],
    ] as const) {
      await expect(
        updateAssignmentSessionRecovery({
          id: session.id,
          userId: tenantA.userId,
          expectedRevision: session.revision,
          patch: {
            recordingId: lineageA.recordingId,
            transcriptId: lineageA.transcriptId,
            promptPackageId,
            draftId,
          },
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID' });
    }

    const unchanged = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query(
        `SELECT revision, recording_id, transcript_id, prompt_package_id, draft_id
         FROM assignment_sessions WHERE id = $1`,
        [session.id],
      );
      return result.rows[0];
    });
    expect(unchanged).toEqual({
      revision: session.revision,
      recording_id: null,
      transcript_id: null,
      prompt_package_id: null,
      draft_id: null,
    });

    await expect(
      updateAssignmentSessionRecovery({
        id: session.id,
        userId: tenantA.userId,
        expectedRevision: session.revision,
        patch: {
          recordingId: lineageA.recordingId,
          transcriptId: lineageA.transcriptId,
          promptPackageId: lineageA.promptPackageId,
          draftId: null,
        },
      }),
    ).resolves.toMatchObject({ promptPackageId: lineageA.promptPackageId, draftId: null });
  });

  it('authorizes Create draft lineage before locking and preserves foreign-vs-absent parity', async () => {
    const tenantA = await seedTenant('Tutor A');
    const tenantB = await seedTenant('Tutor B');
    const lineageA = await seedJobLineage(tenantA, 'a');
    const lineageB = await seedJobLineage(tenantB, 'b');
    const sessionId = await insertContextConfirmedSession(tenantA, lineageA);

    for (const [promptPackageId, draftId] of [
      [lineageB.promptPackageId, lineageB.draftId],
      [randomUUID(), randomUUID()],
      [lineageB.promptPackageId, lineageA.draftId],
    ] as const) {
      await expect(
        confirmAssignmentSessionStepPersistence({
          id: sessionId,
          userId: tenantA.userId,
          request: {
            step: 'create',
            expectedRevision: 3,
            promptPackageId,
            draftId,
            draftWorkingVersion: 1,
          },
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND' });
    }

    await expect(
      confirmAssignmentSessionStepPersistence({
        id: sessionId,
        userId: tenantA.userId,
        request: {
          step: 'create',
          expectedRevision: 3,
          promptPackageId: lineageA.promptPackageId,
          draftId: lineageA.draftId,
          draftWorkingVersion: 1,
        },
      }),
    ).resolves.toMatchObject({ session: { confirmedStep: 'create', revision: 4 } });
  });

  it('does not wait on an attacker-selected foreign draft row lock in Create or recovery', async () => {
    const tenantA = await seedTenant('Tutor A');
    const tenantB = await seedTenant('Tutor B');
    const lineageA = await seedJobLineage(tenantA, 'a');
    const lineageB = await seedJobLineage(tenantB, 'b');
    const createSessionId = await insertContextConfirmedSession(tenantA, lineageA);
    const recoverySession = await confirmStudentAssignmentSession({
      userId: tenantA.userId,
      requestId: randomUUID(),
      studentId: tenantA.studentId,
      lessonId: null,
    });
    const locker = await createPgPool().connect();
    await locker.query('BEGIN');
    await locker.query(`SELECT id FROM drafts WHERE id = $1 FOR UPDATE`, [lineageB.draftId]);
    try {
      const createAttempt = confirmAssignmentSessionStepPersistence({
        id: createSessionId,
        userId: tenantA.userId,
        request: {
          step: 'create',
          expectedRevision: 3,
          promptPackageId: lineageB.promptPackageId,
          draftId: lineageB.draftId,
          draftWorkingVersion: 1,
        },
      });
      await expect(settlesWithin(createAttempt, 500)).resolves.toBe('rejected');

      const recoveryAttempt = updateAssignmentSessionRecovery({
        id: recoverySession.id,
        userId: tenantA.userId,
        expectedRevision: recoverySession.revision,
        patch: {
          recordingId: lineageA.recordingId,
          transcriptId: lineageA.transcriptId,
          promptPackageId: lineageB.promptPackageId,
          draftId: lineageB.draftId,
        },
      });
      await expect(settlesWithin(recoveryAttempt, 500)).resolves.toBe('rejected');
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
  });
});

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number) {
  return Promise.race([
    promise.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'timed_out'>((resolve) => setTimeout(() => resolve('timed_out'), timeoutMs)),
  ]);
}

async function seedJobLineage(tenant: Awaited<ReturnType<typeof seedTenant>>, suffix: string) {
  const recording = await insertRecording({
    workspaceId: tenant.workspaceId,
    source: 'upload',
    studentId: tenant.studentId,
    sourcePath: `${suffix}.mp3`,
    storageUri: `local://recordings/${suffix}.mp3`,
    sha256: suffix.repeat(64).slice(0, 64),
    bytes: 10,
    audioTopology: 'mixed_recording',
    status: 'transcribed',
  });
  const transcript = await insertTranscript({
    recordingId: recording.id,
    storageUri: `local://transcripts/${suffix}.txt`,
    workingVersion: 1,
    contentHash: suffix.repeat(64).slice(0, 64),
    rawResponseUri: null,
    mode: 'timeline',
    model: 'scribe_v2',
    language: 'auto',
    sttProvider: 'elevenlabs',
    fallbackUsed: false,
  });
  const promptPackageId = randomUUID();
  const draftId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO prompt_packages (
         id, recording_id, transcript_id, student_id, template_version, storage_uri
       ) VALUES ($1, $2, $3, $4, 'v1', $5)`,
      [promptPackageId, recording.id, transcript.id, tenant.studentId, `local://prompts/${suffix}`],
    );
    await client.query(
      `INSERT INTO drafts (
         id, prompt_package_id, student_id, storage_uri, working_version, content_hash
       ) VALUES ($1, $2, $3, $4, 1, $5)`,
      [
        draftId,
        promptPackageId,
        tenant.studentId,
        `local://drafts/${suffix}`,
        suffix.repeat(64).slice(0, 64),
      ],
    );
  });
  return {
    recordingId: recording.id,
    transcriptId: transcript.id,
    promptPackageId,
    draftId,
  };
}

async function insertContextConfirmedSession(
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  lineage: Awaited<ReturnType<typeof seedJobLineage>>,
): Promise<string> {
  const id = randomUUID();
  const source = {
    lessonId: null,
    recordingId: lineage.recordingId,
    transcriptId: lineage.transcriptId,
    transcriptWorkingVersion: 1,
    transcriptStorageUri: 'local://transcripts/a.txt',
    transcriptHash: 'a'.repeat(64),
  };
  const context = {
    teacherNotes: null,
    profileId: null,
    profileRevisionId: null,
    profileRevisionHash: null,
  };
  await withPgClientSessionContext({ rlsBypass: true }, (client) =>
    client.query(
      `INSERT INTO assignment_sessions (
         id, user_id, student_id, recording_id, transcript_id, revision,
         confirmed_step, confirmed_snapshot, teacher_notes
       ) VALUES ($1, $2, $3, $4, $5, 3, 'context', $6::jsonb, NULL)`,
      [
        id,
        tenant.userId,
        tenant.studentId,
        lineage.recordingId,
        lineage.transcriptId,
        JSON.stringify({ student: { studentId: tenant.studentId }, source, context, create: null }),
      ],
    ),
  );
  return id;
}

async function seedTenant(label: string) {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [workspaceId, label]);
    await client.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')`,
      [userId, `${userId}@example.test`],
    );
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    await client.query(`INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alex', $2)`, [
      studentId,
      workspaceId,
    ]);
  });
  return { workspaceId, userId, studentId };
}

function createCoreAppForTenant(tenant: Awaited<ReturnType<typeof seedTenant>>): FastifyInstance {
  const app = Fastify();
  registerCoreRoutes(app, {
    config: {} as never,
    authenticate: async (request) => {
      (request as AuthenticatedRequest).user = {
        id: tenant.userId,
        email: `${tenant.userId}@example.test`,
        role: 'user',
      };
    },
  });
  return app;
}

async function captureTargetedJobEvent(app: FastifyInstance, job: JobRecord): Promise<string> {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const response = await fetch(`${address}/jobs/events?jobId=${job.id}`, {
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Expected SSE response body');

  try {
    publishJobEvent({ type: 'job_state_changed', job });
    let payload = '';
    const deadline = Date.now() + 3_000;
    while (!payload.includes(`\"jobId\":\"${job.id}\"`) && Date.now() < deadline) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timed out waiting for standalone job SSE event')), remainingMs),
        ),
      ]);
      if (chunk.done) break;
      payload += new TextDecoder().decode(chunk.value);
    }
    return payload;
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
}
