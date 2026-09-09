import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  claimRecordingAudioCleanupCandidates,
  completeRecordingAudioDeletion,
  failRecordingAudioDeletion,
} from '../src/domain/recording-audio-cleanup-repository.js';
import { insertRecording } from '../src/domain/recording-repository.js';
import {
  beginRecordingUploadOperation,
  recordUploadAttemptCandidate,
} from '../src/domain/recording-upload-operation-repository.js';
import { insertTranscript } from '../src/domain/transcript-repository.js';
import { createQueuedTranscriptionRun } from '../src/domain/transcription-run-repository.js';
import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

const DAY_MS = 24 * 60 * 60 * 1000;

describe('domain/recording-audio-cleanup-repository', () => {
  let tenant: Awaited<ReturnType<typeof seedTenant>>;

  beforeEach(async () => {
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `TRUNCATE TABLE assignment_sessions, transcripts, transcription_runs,
         recordings, students, workspace_memberships, workspaces, users
         RESTART IDENTITY CASCADE`,
      ),
    );
    tenant = await seedTenant();
  });

  it('selects pending, failed-TTL, unconfirmed-transcribed-TTL, and safely stale rows only', async () => {
    const pending = await seedRecording(tenant, { status: 'transcribed' });
    await setRecordingState(pending.id, {
      audioLifecycle: 'pending',
      updatedAt: new Date(),
    });
    const failedOld = await seedRecording(tenant, { status: 'failed' });
    await setRecordingState(failedOld.id, { updatedAt: daysAgo(8) });
    const transcribedOld = await seedRecording(tenant, { status: 'transcribed' });
    await setRecordingState(transcribedOld.id, { updatedAt: daysAgo(8) });
    const failedFresh = await seedRecording(tenant, { status: 'failed' });
    await setRecordingState(failedFresh.id, { updatedAt: daysAgo(6) });
    const transcribedFresh = await seedRecording(tenant, { status: 'transcribed' });
    await setRecordingState(transcribedFresh.id, { updatedAt: daysAgo(6) });
    const previouslyConfirmed = await seedRecording(tenant, { status: 'transcribed' });
    await confirmHistoricalSource(tenant, previouslyConfirmed.id);
    const notRetained = await seedRecording(tenant, {
      status: 'transcribed',
      storageUri: null,
      audioLifecycle: 'not_retained',
    });
    await setRecordingState(notRetained.id, { updatedAt: daysAgo(30) });
    const activeStale = await seedRecording(tenant, { status: 'queued' });
    await createQueuedTranscriptionRun({
      recordingId: activeStale.id,
      workspaceId: tenant.workspaceId,
      provider: 'elevenlabs',
      requestProfile: 'mixed_scribe_v2',
    });
    await setRecordingState(activeStale.id, { updatedAt: daysAgo(8) });
    const safelyStale = await seedRecording(tenant, { status: 'transcribing' });
    await setRecordingState(safelyStale.id, { updatedAt: daysAgo(8) });

    const claims = await claimRecordingAudioCleanupCandidates({
      limit: 20,
      recoveryTtlDays: 7,
      claimLeaseMs: 60_000,
    });

    expect(new Set(claims.map((claim) => claim.recordingId))).toEqual(
      new Set([
        pending.id,
        failedOld.id,
        transcribedOld.id,
        previouslyConfirmed.id,
        safelyStale.id,
      ]),
    );
    expect(claims.find((claim) => claim.recordingId === previouslyConfirmed.id)?.reason).toBe(
      'source_confirmed',
    );
    expect(claims.find((claim) => claim.recordingId === safelyStale.id)?.reason).toBe(
      'safely_stale_processing',
    );
    const excluded = await loadAudioRows([
      failedFresh.id,
      transcribedFresh.id,
      notRetained.id,
      activeStale.id,
    ]);
    expect(excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: failedFresh.id, audio_lifecycle: 'retained' }),
        expect.objectContaining({ id: transcribedFresh.id, audio_lifecycle: 'retained' }),
        expect.objectContaining({ id: notRetained.id, audio_lifecycle: 'not_retained' }),
        expect.objectContaining({ id: activeStale.id, audio_lifecycle: 'retained' }),
      ]),
    );
    const staleRow = (await loadAudioRows([safelyStale.id]))[0];
    expect(staleRow).toMatchObject({
      status: 'failed',
      error: 'transcription_stale',
      audio_lifecycle: 'deleting',
    });
  });

  it('lets racing sweepers claim one current owner and distribute a bounded batch', async () => {
    const first = await seedRecording(tenant, { status: 'transcribed' });
    const second = await seedRecording(tenant, { status: 'transcribed' });
    await setRecordingState(first.id, { audioLifecycle: 'pending', updatedAt: new Date() });
    await setRecordingState(second.id, { audioLifecycle: 'pending', updatedAt: new Date() });

    const [left, right] = await Promise.all([
      claimRecordingAudioCleanupCandidates({ limit: 1, recoveryTtlDays: 7, claimLeaseMs: 60_000 }),
      claimRecordingAudioCleanupCandidates({ limit: 1, recoveryTtlDays: 7, claimLeaseMs: 60_000 }),
    ]);

    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    expect(left[0]?.recordingId).not.toBe(right[0]?.recordingId);
    expect(left[0]?.attemptCount).toBe(1);
    expect(right[0]?.attemptCount).toBe(1);
  });

  it('allows only one racing sweeper to claim the same recording', async () => {
    const recording = await seedRecording(tenant, { status: 'transcribed' });
    await setRecordingState(recording.id, { audioLifecycle: 'pending', updatedAt: new Date() });

    const races = await Promise.all([
      claimRecordingAudioCleanupCandidates({ limit: 1, recoveryTtlDays: 7, claimLeaseMs: 60_000 }),
      claimRecordingAudioCleanupCandidates({ limit: 1, recoveryTtlDays: 7, claimLeaseMs: 60_000 }),
    ]);

    expect(races.flat()).toHaveLength(1);
    expect(races.flat()[0]).toMatchObject({ recordingId: recording.id, attemptCount: 1 });
  });

  it('never claims an unadopted Slice 4 upload-attempt candidate', async () => {
    const operation = await beginRecordingUploadOperation({
      workspaceId: tenant.workspaceId,
      operationUuid: randomUUID(),
      studentId: tenant.studentId,
      audioTopology: 'mixed_recording',
      requestedProvider: 'elevenlabs',
      requestProfile: 'mixed_scribe_v2',
    });
    expect(operation.kind).toBe('claimed');
    if (operation.kind !== 'claimed') throw new Error('Expected upload operation claim.');
    const uri = `local://workspaces/${tenant.workspaceId}/recordings/${operation.operation.recordingId}/candidates/${operation.operation.attemptToken}/audio.mp3`;
    await expect(
      recordUploadAttemptCandidate({
        operationId: operation.operation.id,
        attemptToken: operation.operation.attemptToken!,
        candidateUri: uri,
      }),
    ).resolves.toBe(true);

    await expect(
      claimRecordingAudioCleanupCandidates({ limit: 10, recoveryTtlDays: 7, claimLeaseMs: 60_000 }),
    ).resolves.toEqual([]);
  });

  it('rejects stale completion after reclaim and preserves the newer success', async () => {
    const recording = await seedRecording(tenant, { status: 'transcribed' });
    await setRecordingState(recording.id, { audioLifecycle: 'pending', updatedAt: new Date() });
    const first = (
      await claimRecordingAudioCleanupCandidates({
        limit: 1,
        recoveryTtlDays: 7,
        claimLeaseMs: 60_000,
      })
    )[0]!;
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE recordings SET audio_deletion_next_attempt_at = now() - interval '1 second'
         WHERE id = $1`,
        [recording.id],
      ),
    );
    const second = (
      await claimRecordingAudioCleanupCandidates({
        limit: 1,
        recoveryTtlDays: 7,
        claimLeaseMs: 60_000,
      })
    )[0]!;

    await expect(completeRecordingAudioDeletion(second)).resolves.toBe(true);
    await expect(
      failRecordingAudioDeletion({
        claim: first,
        errorCode: 'recording_audio_delete_failed',
        retryAfterMs: 60_000,
      }),
    ).resolves.toBe(false);
    expect((await loadAudioRows([recording.id]))[0]).toMatchObject({
      audio_lifecycle: 'deleted',
      storage_uri: null,
      audio_deletion_attempt_count: 2,
      audio_deletion_error_code: null,
    });
  });

  it('retries deletion-only failure accounting and preserves recording/transcript lineage', async () => {
    const recording = await seedRecording(tenant, { status: 'transcribed' });
    const transcript = await insertTranscript({
      recordingId: recording.id,
      storageUri: `local://transcripts/${randomUUID()}/content/text.txt`,
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mode: 'timeline',
      model: 'scribe_v2',
      language: 'auto',
      sttProvider: 'elevenlabs',
      fallbackUsed: false,
    });
    await setRecordingState(recording.id, { audioLifecycle: 'pending', updatedAt: new Date() });
    const first = (
      await claimRecordingAudioCleanupCandidates({
        limit: 1,
        recoveryTtlDays: 7,
        claimLeaseMs: 60_000,
      })
    )[0]!;

    await expect(
      failRecordingAudioDeletion({
        claim: first,
        errorCode: 'recording_audio_delete_failed',
        retryAfterMs: 60_000,
      }),
    ).resolves.toBe(true);
    expect((await loadAudioRows([recording.id]))[0]).toMatchObject({
      audio_lifecycle: 'delete_failed',
      storage_uri: first.uri,
      audio_deletion_attempt_count: 1,
      audio_deletion_error_code: 'recording_audio_delete_failed',
    });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE recordings SET audio_deletion_next_attempt_at = now() - interval '1 second'
         WHERE id = $1`,
        [recording.id],
      ),
    );
    const retry = (
      await claimRecordingAudioCleanupCandidates({
        limit: 1,
        recoveryTtlDays: 7,
        claimLeaseMs: 60_000,
      })
    )[0]!;
    await expect(completeRecordingAudioDeletion(retry)).resolves.toBe(true);

    const lineage = await withPgClientSessionContext({ rlsBypass: true }, async (client) => ({
      recording: await client.query(`SELECT id, status FROM recordings WHERE id = $1`, [
        recording.id,
      ]),
      transcript: await client.query(`SELECT id, storage_uri FROM transcripts WHERE id = $1`, [
        transcript.id,
      ]),
    }));
    expect(lineage.recording.rows[0]).toEqual({ id: recording.id, status: 'transcribed' });
    expect(lineage.transcript.rows[0]).toEqual({
      id: transcript.id,
      storage_uri: transcript.storageUri,
    });
  });
});

async function seedTenant() {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, 'hash', 'user')`,
      [userId, `${userId}@example.test`],
    );
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Cleanup test')`, [
      workspaceId,
    ]);
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    await client.query(
      `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Cleanup Student', $2)`,
      [studentId, workspaceId],
    );
  });
  return { userId, workspaceId, studentId };
}

async function seedRecording(
  owner: Awaited<ReturnType<typeof seedTenant>>,
  params: {
    status: 'queued' | 'transcribing' | 'transcribed' | 'failed';
    storageUri?: string | null;
    audioLifecycle?: 'retained' | 'not_retained';
  },
) {
  const id = randomUUID();
  return insertRecording({
    id,
    workspaceId: owner.workspaceId,
    source: 'upload',
    studentId: owner.studentId,
    sourcePath: `${id}.mp3`,
    storageUri:
      params.storageUri === undefined
        ? `local://workspaces/${owner.workspaceId}/recordings/${id}/audio.mp3`
        : params.storageUri,
    audioLifecycle: params.audioLifecycle,
    bytes: 12,
    audioTopology: 'mixed_recording',
    status: params.status,
  });
}

async function setRecordingState(
  recordingId: string,
  params: { audioLifecycle?: 'pending'; updatedAt: Date },
) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('ALTER TABLE recordings DISABLE TRIGGER set_recordings_updated_at');
    try {
      await client.query(
        `UPDATE recordings
         SET audio_lifecycle = COALESCE($2::text, audio_lifecycle),
             audio_deletion_requested_at = CASE WHEN $2::text = 'pending' THEN now() ELSE audio_deletion_requested_at END,
             updated_at = $3
         WHERE id = $1`,
        [recordingId, params.audioLifecycle ?? null, params.updatedAt],
      );
    } finally {
      await client.query('ALTER TABLE recordings ENABLE TRIGGER set_recordings_updated_at');
    }
  });
}

async function loadAudioRows(recordingIds: string[]) {
  return withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    const result = await client.query(
      `SELECT id, status, error, storage_uri, audio_lifecycle,
              audio_deletion_attempt_count, audio_deletion_error_code
       FROM recordings WHERE id = ANY($1::uuid[])`,
      [recordingIds],
    );
    return result.rows;
  });
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

async function confirmHistoricalSource(
  owner: Awaited<ReturnType<typeof seedTenant>>,
  recordingId: string,
): Promise<void> {
  await withPgClientSessionContext({ rlsBypass: true }, (client) =>
    client.query(
      `INSERT INTO assignment_sessions
         (id, user_id, student_id, recording_id, revision, confirmed_step, confirmed_snapshot)
       VALUES ($1, $2, $3, $4, 1, 'source', $5::jsonb)`,
      [
        randomUUID(),
        owner.userId,
        owner.studentId,
        recordingId,
        JSON.stringify({
          student: { studentId: owner.studentId },
          source: { recordingId },
          context: null,
          create: null,
        }),
      ],
    ),
  );
}
