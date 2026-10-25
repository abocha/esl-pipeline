import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { serializeAssignmentV1 } from '@esl-pipeline/contracts';
import { manifestPathFor } from '@esl-pipeline/orchestrator';

import { assignmentHash } from '../src/application/assignment-artifact.js';
import { processQueueJob } from '../src/application/process-queue-job.js';
import * as promptRepository from '../src/domain/prompt-package-repository.js';
import * as h from './application.process-queue-job.test-harness.js';
import { assignmentFixture, promptPackageFixture } from './assignment-v1.test-harness.js';

const {
  makeJob,
  getJobByIdSpy,
  updateJobStateAndResultSpy,
  runAssignmentJobSpy,
  runRerunAssignmentJobSpy,
  createTranscriptionStorageForUriSpy,
} = h;

describe('application/process-queue-job', () => {
  it('rejects unsupported native renderer identity before reading or rendering', async () => {
    const initial = makeJob({ assignmentRendererVersion: 4 });
    getJobByIdSpy.mockResolvedValue(initial);
    updateJobStateAndResultSpy.mockResolvedValue({ ...initial, state: 'running' });
    await expect(processQueueJob({ jobId: initial.id })).rejects.toThrow(
      'Unsupported structured assignment renderer version',
    );
    expect(createTranscriptionStorageForUriSpy).not.toHaveBeenCalled();
    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
  });
  it('retains the initial typed filesystem manifest without a temporary projection', async () => {
    const uploadDir = await fs.mkdtemp(path.join(tmpdir(), 'esl-typed-manifest-'));
    vi.stubEnv('FILESYSTEM_UPLOAD_DIR', uploadDir);
    const assignment = assignmentFixture();
    const hash = assignmentHash(assignment);
    const initial = makeJob({
      md: null,
      assignmentArtifact: {
        format: 'assignment_v1',
        schemaVersion: 1,
        serializationVersion: 1,
        workingVersion: 1,
        contentHash: hash,
        storageUri: `local://drafts/test/content/${hash}.json`,
      },
      assignmentRendererVersion: 3,
      promptPackageId: 'prompt-1',
    });
    getJobByIdSpy.mockResolvedValue(initial);
    const running = makeJob({ ...initial, state: 'running' });
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce({ ...running, state: 'succeeded' });
    const prompt = vi
      .spyOn(promptRepository, 'getPromptPackageById')
      .mockResolvedValue(promptPackageFixture() as never);
    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue(serializeAssignmentV1(assignment)),
    } as never);
    let temporaryManifest!: string;
    runAssignmentJobSpy.mockImplementation(async (payload) => {
      temporaryManifest = manifestPathFor(payload.md);
      await fs.mkdir(path.dirname(temporaryManifest), { recursive: true });
      await fs.writeFile(temporaryManifest, '{"mdHash":"typed-projection"}', 'utf8');
      return { manifestPath: temporaryManifest };
    });
    try {
      await processQueueJob({ jobId: initial.id });
      const durable = path.join(uploadDir, 'assignments', `${initial.id}.manifest.json`);
      expect(await fs.readFile(durable, 'utf8')).toBe('{"mdHash":"typed-projection"}');
      expect(temporaryManifest).toBe(durable);
      expect(updateJobStateAndResultSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ manifestPath: durable }),
      );
    } finally {
      prompt.mockRestore();
      vi.unstubAllEnvs();
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('publishes frozen typed JSON with a canonical assignment hash and child-owned correction identity', async () => {
    const assignment = assignmentFixture();
    const hash = assignmentHash(assignment);
    const artifact = {
      format: 'assignment_v1' as const,
      schemaVersion: 1 as const,
      serializationVersion: 1 as const,
      workingVersion: 2,
      storageUri: `local://drafts/test/content/${hash}.json`,
      contentHash: hash,
    };
    const initial = makeJob({
      md: '/unrelated-later-draft.md',
      mdStorageUri: 'local://unreadable-projection.md',
      assignmentArtifact: artifact,
      assignmentRendererVersion: 3,
      promptPackageId: 'prompt-1',
      studentId: 'student-1',
      sourceJobId: 'job-parent',
    });
    getJobByIdSpy.mockResolvedValue(initial);
    const running = makeJob({ ...initial, state: 'running' });
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce({ ...running, state: 'succeeded', htmlUrl: 'https://test/typed' });
    const prompt = vi
      .spyOn(promptRepository, 'getPromptPackageById')
      .mockResolvedValue(promptPackageFixture() as never);
    const read = vi.fn().mockResolvedValue(serializeAssignmentV1(assignment));
    createTranscriptionStorageForUriSpy.mockReturnValue({ getText: read } as never);
    runAssignmentJobSpy.mockImplementation(async (payload) => {
      expect(payload.assignment).toEqual(assignment);
      await expect(fs.access(payload.md)).rejects.toThrow();
      expect(payload.md).toMatch(/[\\/]job-1\.md$/);
      return { manifestPath: 's3://manifests/job-1.manifest.json' };
    });
    try {
      await processQueueJob({
        jobId: initial.id,
        sourceJobId: 'job-parent',
        executionMode: 'correction',
        correction: { expectedAssignmentHash: hash, manifestMd: 'corrections/job-1.md' },
      });
      expect(read).toHaveBeenCalledWith(artifact.storageUri);

      expect(updateJobStateAndResultSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ publishedContentHash: hash }),
      );
      expect(h.requestHomeworkMemoryGenerationSpy).toHaveBeenCalled();
    } finally {
      prompt.mockRestore();
    }
  });

  it('fails typed correction identity mismatch before rendering or pipeline execution', async () => {
    const hash = 'a'.repeat(64);
    const initial = makeJob({
      assignmentArtifact: {
        format: 'assignment_v1',
        schemaVersion: 1,
        serializationVersion: 1,
        workingVersion: 1,
        storageUri: `local://drafts/test/content/${hash}.json`,
        contentHash: hash,
      },
      assignmentRendererVersion: 3,
      promptPackageId: 'prompt-1',
      sourceJobId: 'job-parent',
    });
    getJobByIdSpy.mockResolvedValue(initial);
    updateJobStateAndResultSpy
      .mockResolvedValueOnce({ ...initial, state: 'running' })
      .mockResolvedValueOnce({ ...initial, state: 'failed' });
    await expect(
      processQueueJob({
        jobId: initial.id,
        sourceJobId: 'job-parent',
        executionMode: 'correction',
        correction: { expectedAssignmentHash: 'b'.repeat(64), manifestMd: 'corrections/job-1.md' },
      }),
    ).rejects.toThrow('Correction assignment identity mismatch');
    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(updateJobStateAndResultSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextState: 'failed' }),
    );
  });
  it.each(['queued', 'running', 'awaiting_approval', 'failed', 'succeeded'] as const)(
    'skips every retained legacy %s delivery without pipeline execution',
    async (state) => {
      getJobByIdSpy.mockResolvedValue(makeJob({ state, assignmentArtifact: null }));
      updateJobStateAndResultSpy.mockResolvedValue(null);
      await processQueueJob({
        jobId: 'job-1',
        executionMode: 'correction',
        sourceJobId: 'parent',
        correction: { expectedAssignmentHash: 'a'.repeat(64), manifestMd: 'correction.md' },
      });
      expect(runAssignmentJobSpy).not.toHaveBeenCalled();
      expect(runRerunAssignmentJobSpy).not.toHaveBeenCalled();
      expect(createTranscriptionStorageForUriSpy).not.toHaveBeenCalled();
      if (state === 'failed' || state === 'succeeded')
        expect(updateJobStateAndResultSpy).not.toHaveBeenCalled();
    },
  );
});
