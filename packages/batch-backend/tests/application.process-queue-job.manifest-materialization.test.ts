import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as h from './application.process-queue-job.test-harness.js';
import { processQueueJob } from '../src/application/process-queue-job.js';

const {
  makeJob,
  getJobByIdSpy,
  updateJobStateAndResultSpy,
  runAssignmentJobSpy,
  runRerunAssignmentJobSpy,
  createTranscriptionStorageForUriSpy,
} = h;

describe('application/process-queue-job', () => {
  it('uses manifestMd from rerun payload when markdown is materialized from storage', async () => {
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
        startedAt: new Date('2024-01-01T10:01:00Z'),
      });
      const succeeded = {
        ...running,
        state: 'succeeded',
        manifestPath: '/manifests/job-rerun-publish-storage.json',
        finishedAt: new Date('2024-01-01T10:02:00Z'),
        anytypeUrl: 'https://anytype.io/page',
        notionUrl: null,
      };
      updateJobStateAndResultSpy
        .mockResolvedValueOnce(running as any)
        .mockResolvedValueOnce(succeeded as any);
  
      createTranscriptionStorageForUriSpy.mockReturnValue({
        getText: vi.fn().mockResolvedValue('# Draft from S3'),
      } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);
  
      runRerunAssignmentJobSpy.mockResolvedValue({
        manifestPath: '/manifests/job-rerun-publish-storage.json',
        anytypeUrl: 'https://anytype.io/page',
      });
  
      await processQueueJob({
        jobId: 'job-1',
        executionMode: 'rerun_publish',
        sourceJobId: 'job-source',
        rerun: {
          manifestMd: '/tmp/source-assignment.md',
          steps: ['add-audio'],
          upload: 's3',
          force: false,
        },
      });
  
      expect(runRerunAssignmentJobSpy).toHaveBeenCalledTimes(1);
      const [payload] = runRerunAssignmentJobSpy.mock.calls[0]!;
      expect(path.isAbsolute(payload.md)).toBe(true);
      expect(payload.manifestMd).toBe('/tmp/source-assignment.md');
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
        notionUrl: 'https://notion.so/job-rerun-manifest-normalized',
        anytypeUrl: null,
      };
      updateJobStateAndResultSpy
        .mockResolvedValueOnce(running as any)
        .mockResolvedValueOnce(succeeded as any);
  
      runRerunAssignmentJobSpy.mockResolvedValue({
        manifestPath: '/manifests/job-rerun-manifest-normalized.json',
        notionUrl: 'https://notion.so/job-rerun-manifest-normalized',
      });
  
      try {
        await processQueueJob({
          jobId: 'job-1',
          executionMode: 'rerun_audio',
          sourceJobId: 'job-source',
          rerun: {
            steps: ['tts', 'upload', 'add-audio'],
            manifestMd: 'lesson.md',
            upload: 's3',
            force: false,
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
        notionUrl: 'https://notion.so/job-rerun-manifest-fallback',
        anytypeUrl: null,
      };
      updateJobStateAndResultSpy
        .mockResolvedValueOnce(running as any)
        .mockResolvedValueOnce(succeeded as any);
  
      runRerunAssignmentJobSpy.mockResolvedValue({
        manifestPath: '/manifests/job-rerun-manifest-fallback.json',
        notionUrl: 'https://notion.so/job-rerun-manifest-fallback',
      });
  
      try {
        await processQueueJob({
          jobId: 'job-1',
          executionMode: 'rerun_audio',
          sourceJobId: 'job-source',
          rerun: {
            steps: ['tts', 'upload', 'add-audio'],
            upload: 's3',
            force: false,
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
        notionUrl: 'https://notion.so/job-1',
        anytypeUrl: null,
      };
      updateJobStateAndResultSpy.mockResolvedValueOnce(running as any).mockResolvedValueOnce(
        succeeded as any,
      );
  
      createTranscriptionStorageForUriSpy.mockReturnValue({
        getText: vi.fn().mockResolvedValue('# Draft from S3'),
      } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);
  
      runAssignmentJobSpy.mockResolvedValue({
        manifestPath: '/manifests/job-1.json',
        notionUrl: 'https://notion.so/job-1',
      });
  
      await processQueueJob({ jobId: 'job-1' });
  
      expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
      const [payload] = runAssignmentJobSpy.mock.calls[0]!;
      expect(path.isAbsolute(payload.md)).toBe(true);
  
      await expect(fs.access(payload.md)).rejects.toThrow();
    });
});
