import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { serializeAssignmentV1 } from '@esl-pipeline/contracts';
import { manifestPathFor } from '@esl-pipeline/orchestrator';

import { assignmentHash } from '../src/application/assignment-artifact.js';
import { processQueueJob } from '../src/application/process-queue-job.js';
import * as promptRepository from '../src/domain/prompt-package-repository.js';
import * as transcriptionStorage from '../src/infrastructure/transcription-storage.js';
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
      assignmentRendererVersion: 1,
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
      assignmentRendererVersion: 1,
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
      assignmentRendererVersion: 1,
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
  it('uses a child-specific markdown basename for correction manifest identity', async () => {
    const markdown = '# Corrected assignment';
    const expectedHash = createHash('sha256').update(markdown, 'utf8').digest('hex');
    const initial = makeJob({
      state: 'queued',
      md: null,
      mdStorageUri: `s3://esl-notion-tts/drafts/draft-1/content/${expectedHash}.md`,
      sourceJobId: 'job-parent',
    });
    getJobByIdSpy.mockResolvedValue(initial);
    const running = makeJob({ ...initial, state: 'running', startedAt: new Date() });
    const succeeded = { ...running, state: 'succeeded', finishedAt: new Date() };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as never)
      .mockResolvedValueOnce(succeeded as never);
    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue(markdown),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);
    runAssignmentJobSpy.mockResolvedValue({ manifestPath: 's3://manifests/job-1.manifest.json' });

    await processQueueJob({
      jobId: 'job-1',
      sourceJobId: 'job-parent',
      executionMode: 'correction',
      correction: {
        expectedMarkdownHash: expectedHash,
        manifestMd: 'corrections/job-1.md',
      },
    } as never);

    const [payload] = runAssignmentJobSpy.mock.calls[0]!;
    expect(payload.md).toMatch(/[\\/]job-1\.md$/);
    expect(updateJobStateAndResultSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ publishedContentHash: expectedHash }),
    );
  });

  it('persists the exact filesystem markdown hash with successful publication', async () => {
    const markdown = '# Filesystem assignment\n';
    const expectedHash = createHash('sha256').update(markdown, 'utf8').digest('hex');
    const markdownDir = await fs.mkdtemp(path.join(tmpdir(), 'esl-filesystem-markdown-'));
    const markdownPath = path.join(markdownDir, 'assignment.md');
    await fs.writeFile(markdownPath, markdown, 'utf8');
    const initial = makeJob({ state: 'queued', md: markdownPath, mdStorageUri: null });
    getJobByIdSpy.mockResolvedValue(initial);
    const running = makeJob({ ...initial, state: 'running', startedAt: new Date() });
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as never)
      .mockResolvedValueOnce({ ...running, state: 'succeeded', finishedAt: new Date() } as never);
    runAssignmentJobSpy.mockResolvedValue({ manifestPath: '/manifests/filesystem.json' });

    try {
      await processQueueJob({ jobId: initial.id } as never);

      expect(updateJobStateAndResultSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ publishedContentHash: expectedHash }),
      );
    } finally {
      await fs.rm(markdownDir, { recursive: true, force: true });
    }
  });

  it('promotes a correction manifest to the child-owned durable identity instead of its parent', async () => {
    const markdown = '# Corrected assignment';
    const expectedHash = createHash('sha256').update(markdown, 'utf8').digest('hex');
    const uploadDir = await fs.mkdtemp(path.join(tmpdir(), 'esl-correction-manifest-'));
    const durableManifestPath = path.join(uploadDir, 'corrections', 'job-child.manifest.json');
    let materializedManifestPath: string | undefined;
    const previousUploadDir = process.env.FILESYSTEM_UPLOAD_DIR;
    process.env.FILESYSTEM_UPLOAD_DIR = uploadDir;

    const initial = makeJob({
      state: 'queued',
      md: null,
      mdStorageUri: `s3://esl-notion-tts/drafts/draft-1/content/${expectedHash}.md`,
      sourceJobId: 'job-parent',
    });
    getJobByIdSpy.mockResolvedValue(initial);
    const running = makeJob({ ...initial, state: 'running', startedAt: new Date() });
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as never)
      .mockResolvedValueOnce({ ...running, state: 'succeeded', finishedAt: new Date() } as never);
    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue(markdown),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);
    runAssignmentJobSpy.mockImplementation(async (payload) => {
      materializedManifestPath = path.join(path.dirname(payload.md), 'job-child.manifest.json');
      await fs.writeFile(materializedManifestPath, '{"mdHash":"correction"}', 'utf8');
      return { manifestPath: materializedManifestPath };
    });

    try {
      await processQueueJob({
        jobId: 'job-child',
        sourceJobId: 'job-parent',
        executionMode: 'correction',
        correction: {
          expectedMarkdownHash: expectedHash,
          manifestMd: 'corrections/job-child.md',
        },
      });

      expect(updateJobStateAndResultSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ manifestPath: durableManifestPath }),
      );
      await expect(fs.readFile(durableManifestPath, 'utf8')).resolves.toContain('correction');
      await expect(
        fs.access(path.join(uploadDir, 'corrections', 'job-parent.manifest.json')),
      ).rejects.toThrow();
      expect(materializedManifestPath).toBeDefined();
      await expect(fs.access(path.dirname(materializedManifestPath!))).rejects.toThrow();
    } finally {
      if (previousUploadDir == null) delete process.env.FILESYSTEM_UPLOAD_DIR;
      else process.env.FILESYSTEM_UPLOAD_DIR = previousUploadDir;
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('cleans up materialized correction markdown when the pipeline fails', async () => {
    const markdown = '# Corrected assignment';
    const expectedHash = createHash('sha256').update(markdown, 'utf8').digest('hex');
    const initial = makeJob({
      state: 'queued',
      md: null,
      mdStorageUri: `s3://esl-notion-tts/drafts/draft-1/content/${expectedHash}.md`,
      sourceJobId: 'job-parent',
    });
    getJobByIdSpy.mockResolvedValue(initial);
    const running = makeJob({ ...initial, state: 'running', startedAt: new Date() });
    const failed = {
      ...running,
      state: 'failed',
      error: 'correction pipeline failed',
      finishedAt: new Date(),
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as never)
      .mockResolvedValueOnce(failed as never);
    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue(markdown),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);

    let materializedMarkdownPath: string | undefined;
    const pipelineError = new Error('correction pipeline failed');
    runAssignmentJobSpy.mockImplementation(async (payload) => {
      materializedMarkdownPath = payload.md;
      throw pipelineError;
    });

    await expect(
      processQueueJob({
        jobId: 'job-child',
        sourceJobId: 'job-parent',
        executionMode: 'correction',
        correction: {
          expectedMarkdownHash: expectedHash,
          manifestMd: 'corrections/job-child.md',
        },
      }),
    ).rejects.toBe(pipelineError);

    expect(materializedMarkdownPath).toBeDefined();
    await expect(fs.access(path.dirname(materializedMarkdownPath!))).rejects.toThrow();
  });

  it('fails closed when correction storage does not match the reserved markdown hash', async () => {
    const expectedHash = 'a'.repeat(64);
    const initial = makeJob({
      state: 'queued',
      md: null,
      mdStorageUri: `s3://esl-notion-tts/drafts/draft-1/content/${expectedHash}.md`,
      sourceJobId: 'job-source',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({ ...initial, state: 'running', startedAt: new Date() });
    updateJobStateAndResultSpy.mockResolvedValueOnce(running as never).mockResolvedValueOnce({
      ...running,
      state: 'failed',
      error: 'Correction markdown content hash mismatch',
    } as never);
    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue('# changed content'),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);

    await expect(
      processQueueJob({
        jobId: 'job-1',
        sourceJobId: 'job-source',
        executionMode: 'correction',
        correction: {
          expectedMarkdownHash: expectedHash,
          manifestMd: 'corrections/job-1.md',
        },
      }),
    ).rejects.toThrow('Correction markdown content hash mismatch');

    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
  });

  it('rejects rerun jobs that only have stored draft markdown', async () => {
    const initial = makeJob({
      state: 'queued',
      md: null,
      mdStorageUri: 's3://esl-notion-tts/drafts/draft-1.md',
      sourceJobId: 'job-source',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      md: null,
      mdStorageUri: 's3://esl-notion-tts/drafts/draft-1.md',
      sourceJobId: 'job-source',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const failed = {
      ...running,
      state: 'failed',
      error: 'Rerun job is missing an approved markdown source',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(failed as any);

    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue('# Draft from S3'),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-publish-storage.json',
      htmlUrl: 'https://example.com/job-rerun-publish-storage',
    });

    await expect(
      processQueueJob({
        jobId: 'job-1',
        executionMode: 'rerun',
        sourceJobId: 'job-source',
        rerun: {
          manifestMd: '/tmp/source-assignment.md',
          republishOnly: true,
          upload: 's3',
        },
      }),
    ).rejects.toThrow('Rerun job is missing an approved markdown source');

    expect(createTranscriptionStorageForUriSpy).not.toHaveBeenCalled();
    expect(runRerunAssignmentJobSpy).not.toHaveBeenCalled();
  });

  it('prefers the approved markdown path over stored draft text for reruns', async () => {
    const uploadDir = await fs.mkdtemp(path.join(tmpdir(), 'esl-process-queue-rerun-md-'));
    const approvedPath = path.join(uploadDir, 'approved.md');
    await fs.writeFile(
      approvedPath,
      '---\nstudent: "Alice Nguyen"\n---\n\n# Approved assignment',
      'utf8',
    );

    const initial = makeJob({
      state: 'queued',
      md: approvedPath,
      mdStorageUri: 's3://esl-notion-tts/drafts/raw-placeholder-student.md',
      sourceJobId: 'job-source',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      md: approvedPath,
      mdStorageUri: 's3://esl-notion-tts/drafts/raw-placeholder-student.md',
      sourceJobId: 'job-source',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun-approved-md.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-rerun-approved-md',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue('---\nstudent: student\n---\n\n# Raw draft'),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-approved-md.json',
      htmlUrl: 'https://example.com/job-rerun-approved-md',
    });

    try {
      await processQueueJob({
        jobId: 'job-1',
        executionMode: 'rerun',
        sourceJobId: 'job-source',
        rerun: {
          regeneratePronunciationChunkAudio: true,
          manifestMd: approvedPath,
          upload: 's3',
        },
      });

      expect(createTranscriptionStorageForUriSpy).not.toHaveBeenCalled();
      expect(runRerunAssignmentJobSpy).toHaveBeenCalledTimes(1);
      const [payload] = runRerunAssignmentJobSpy.mock.calls[0]!;
      expect(payload.md).toBe(approvedPath);
      expect(payload.manifestMd).toBe(approvedPath);
    } finally {
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('normalizes relative manifestMd to the canonical resolved markdown path', async () => {
    const uploadDir = await fs.mkdtemp(path.join(tmpdir(), 'esl-process-queue-manifest-'));
    const lessonPath = path.join(uploadDir, 'lesson.md');
    await fs.writeFile(lessonPath, '# Lesson', 'utf8');
    const prevUploadDir = process.env.FILESYSTEM_UPLOAD_DIR;
    process.env.FILESYSTEM_UPLOAD_DIR = uploadDir;

    const initial = makeJob({ state: 'queued', md: 'lesson.md' });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      md: 'lesson.md',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun-manifest-normalized.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-rerun-manifest-normalized',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-manifest-normalized.json',
      htmlUrl: 'https://example.com/job-rerun-manifest-normalized',
    });

    try {
      await processQueueJob({
        jobId: 'job-1',
        executionMode: 'rerun',
        sourceJobId: 'job-source',
        rerun: {
          regenerateStudyTextAudio: true,
          manifestMd: 'lesson.md',
          upload: 's3',
        },
      });

      expect(runRerunAssignmentJobSpy).toHaveBeenCalledTimes(1);
      const [payload] = runRerunAssignmentJobSpy.mock.calls[0]!;
      expect(payload.md).toBe(lessonPath);
      expect(payload.manifestMd).toBe(lessonPath);
    } finally {
      if (prevUploadDir == null) {
        delete process.env.FILESYSTEM_UPLOAD_DIR;
      } else {
        process.env.FILESYSTEM_UPLOAD_DIR = prevUploadDir;
      }
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('falls back manifestMd to resolved markdown path when rerun manifest is omitted', async () => {
    const uploadDir = await fs.mkdtemp(path.join(tmpdir(), 'esl-process-queue-manifest-'));
    const lessonPath = path.join(uploadDir, 'lesson-fallback.md');
    await fs.writeFile(lessonPath, '# Lesson fallback', 'utf8');
    const prevUploadDir = process.env.FILESYSTEM_UPLOAD_DIR;
    process.env.FILESYSTEM_UPLOAD_DIR = uploadDir;

    const initial = makeJob({ state: 'queued', md: 'lesson-fallback.md' });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      md: 'lesson-fallback.md',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun-manifest-fallback.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-rerun-manifest-fallback',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-manifest-fallback.json',
      htmlUrl: 'https://example.com/job-rerun-manifest-fallback',
    });

    try {
      await processQueueJob({
        jobId: 'job-1',
        executionMode: 'rerun',
        sourceJobId: 'job-source',
        rerun: {
          regenerateStudyTextAudio: true,
          upload: 's3',
        },
      });

      expect(runRerunAssignmentJobSpy).toHaveBeenCalledTimes(1);
      const [payload] = runRerunAssignmentJobSpy.mock.calls[0]!;
      expect(payload.md).toBe(lessonPath);
      expect(payload.manifestMd).toBe(lessonPath);
    } finally {
      if (prevUploadDir == null) {
        delete process.env.FILESYSTEM_UPLOAD_DIR;
      } else {
        process.env.FILESYSTEM_UPLOAD_DIR = prevUploadDir;
      }
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('materializes markdown from storage URI when md path is missing', async () => {
    const initial = makeJob({
      state: 'queued',
      md: null,
      mdStorageUri: 's3://esl-notion-tts/drafts/draft-1.md',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      md: null,
      mdStorageUri: 's3://esl-notion-tts/drafts/draft-1.md',
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-1.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-1',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue('# Draft from S3'),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);

    runAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-1.json',
      htmlUrl: 'https://example.com/job-1',
    });

    await processQueueJob({ jobId: 'job-1' });

    expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
    const [payload] = runAssignmentJobSpy.mock.calls[0]!;
    expect(path.isAbsolute(payload.md)).toBe(true);

    await expect(fs.access(payload.md)).rejects.toThrow();
  });

  it('promotes new-assignment manifests from worker temp paths to the durable job markdown path', async () => {
    const uploadDir = await fs.mkdtemp(path.join(tmpdir(), 'esl-process-queue-durable-manifest-'));
    const lessonPath = path.join(uploadDir, 'lesson-from-storage.md');
    const durableManifestPath = manifestPathFor(lessonPath);
    const workerTempDir = await fs.mkdtemp(
      path.join(tmpdir(), 'esl-process-queue-worker-manifest-'),
    );
    const tempManifestPath = path.join(workerTempDir, 'assignment.manifest.json');
    await fs.writeFile(lessonPath, '# Lesson from storage', 'utf8');
    await fs.writeFile(
      tempManifestPath,
      JSON.stringify({
        schemaVersion: 3,
        mdHash: 'temp-hash',
        publishTarget: 'html',
        timestamp: '2026-04-14T00:00:00.000Z',
      }),
      'utf8',
    );

    const prevUploadDir = process.env.FILESYSTEM_UPLOAD_DIR;
    process.env.FILESYSTEM_UPLOAD_DIR = uploadDir;

    const initial = makeJob({
      state: 'queued',
      md: 'lesson-from-storage.md',
      mdStorageUri: 's3://esl-notion-tts/drafts/lesson-from-storage.md',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      md: 'lesson-from-storage.md',
      mdStorageUri: 's3://esl-notion-tts/drafts/lesson-from-storage.md',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: durableManifestPath,
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-durable-manifest',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue('# Draft from S3'),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);

    runAssignmentJobSpy.mockResolvedValue({
      manifestPath: tempManifestPath,
      htmlUrl: 'https://example.com/job-durable-manifest',
    });

    try {
      await processQueueJob({ jobId: 'job-1' });

      expect(updateJobStateAndResultSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'job-1',
          nextState: 'succeeded',
          manifestPath: durableManifestPath,
        }),
      );
      await expect(fs.readFile(durableManifestPath, 'utf8')).resolves.toContain(
        '"mdHash":"temp-hash"',
      );
    } finally {
      if (prevUploadDir == null) {
        delete process.env.FILESYSTEM_UPLOAD_DIR;
      } else {
        process.env.FILESYSTEM_UPLOAD_DIR = prevUploadDir;
      }
      await fs.rm(uploadDir, { recursive: true, force: true });
      await fs.rm(workerTempDir, { recursive: true, force: true });
    }
  });
});
