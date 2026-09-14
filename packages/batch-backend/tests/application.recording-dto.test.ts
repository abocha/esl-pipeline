import { describe, expect, it } from 'vitest';

import { getRecording } from '../src/application/get-recording.js';
import { recordingToDto } from '../src/application/recording-dto.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import type { TranscriptionRun } from '../src/domain/transcription-run-repository.js';

const recording: RecordingRecord = {
  id: '00000000-0000-4000-8000-000000000101',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  source: 'upload',
  studentId: '00000000-0000-4000-8000-000000000002',
  sourcePath: 'lesson.mp3',
  storageUri: 'memory://lesson.mp3',
  bytes: 12,
  audioLifecycle: 'retained',
  status: 'transcribing',
  error: null,
  createdAt: new Date('2026-09-07T00:00:00.000Z'),
  updatedAt: new Date('2026-09-07T00:00:01.000Z'),
};

function run(
  state: TranscriptionRun['state'],
  errorCode: string | null = null,
): Pick<TranscriptionRun, 'state' | 'errorCode'> {
  return { state, errorCode };
}

describe('recordingToDto canonical projection', () => {
  it.each([
    ['queued', 'waiting'],
    ['submitting', 'transcribing'],
    ['retry_wait', 'retrying'],
    ['succeeded', 'ready'],
    ['failed', 'attention'],
  ] as const)('projects run %s as product state %s', (runState, productState) => {
    expect(recordingToDto(recording, run(runState))).toMatchObject({ runState, productState });
  });

  it('keeps retry_wait nonterminal and hides its attempt diagnostic', () => {
    expect(recordingToDto(recording, run('retry_wait', 'raw-provider-error'))).toMatchObject({
      productState: 'retrying',
      error: null,
      errorCode: null,
    });
  });

  it('projects a cache hit as ready with no run or audio', () => {
    expect(
      recordingToDto(
        {
          ...recording,
          storageUri: null,
          audioLifecycle: 'not_retained',
          status: 'transcribed',
          transcriptId: '00000000-0000-4000-8000-000000000102',
        },
        null,
      ),
    ).toMatchObject({
      productState: 'ready',
      runState: null,
      audioLifecycle: 'not_retained',
      audioAvailable: false,
    });
  });

  it.each(['pending', 'deleting', 'deleted', 'delete_failed'] as const)(
    'reports %s retained audio as unavailable before or after physical deletion',
    (audioLifecycle) => {
      expect(
        recordingToDto(
          {
            ...recording,
            storageUri: audioLifecycle === 'deleted' ? null : recording.storageUri,
            audioLifecycle,
            status: 'transcribed',
          },
          null,
        ),
      ).toMatchObject({ audioLifecycle, audioAvailable: false });
    },
  );

  it('exposes only stable terminal error codes', () => {
    expect(
      recordingToDto({ ...recording, status: 'failed' }, run('failed', 'speakers_not_separated')),
    ).toMatchObject({ errorCode: 'speakers_not_separated' });
    expect(
      recordingToDto(
        { ...recording, status: 'failed' },
        run('failed', 'transcription_provider_account_unavailable'),
      ),
    ).toMatchObject({
      errorCode: 'transcription_provider_account_unavailable',
      error: 'transcription_provider_account_unavailable',
    });
    expect(
      recordingToDto({ ...recording, status: 'failed' }, run('failed', 'provider-secret')),
    ).toMatchObject({ error: null, errorCode: null });
  });

  it('loads the latest durable run for the canonical API projection', async () => {
    const projection = await getRecording(recording.id, recording.workspaceId, {
      recordings: {
        getById: async () => recording,
      } as never,
      transcripts: {
        getByRecordingId: async () => null,
      } as never,
      transcriptionRuns: {
        getLatestForRecording: async () =>
          ({
            recordingId: recording.id,
            workspaceId: recording.workspaceId,
            state: 'retry_wait',
            errorCode: 'raw-provider-error',
          }) as never,
      } as never,
    });

    expect(projection).toMatchObject({
      status: 'transcribing',
      productState: 'retrying',
      runState: 'retry_wait',
      errorCode: null,
    });
  });
});
