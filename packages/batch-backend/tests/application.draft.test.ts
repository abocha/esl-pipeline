import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createDraft } from '../src/application/create-draft.js';
import { materializeDraft } from '../src/application/materialize-draft.js';
import type { DraftRecord } from '../src/domain/draft-model.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import type { TranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

describe('application/draft', () => {
  it('creates a draft for a prompt package', async () => {
    const promptPackage: PromptPackageRecord = {
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: 'student-1',
      profilePath: null,
      templateVersion: '/templates/t1.md',
      notes: null,
      storageUri: 'local://prompt-packages/prompt-1.txt',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    };

    const storage = createStorageStub({
      putDraft: async ({ draftId, text }) => {
        expect(text).toBe('DRAFT TEXT');
        return { uri: `local://drafts/${draftId}.md`, bytes: text.length };
      },
    });

    const draft = await createDraft(
      {
        promptPackageId: promptPackage.id,
        text: 'DRAFT TEXT',
        createdBy: 'user-1',
      },
      {
        storage,
        promptPackages: {
          getById: async () => promptPackage,
        },
        drafts: {
          insert: async (params) => ({
            id: params.id ?? 'draft-1',
            promptPackageId: params.promptPackageId,
            studentId: params.studentId ?? null,
            storageUri: params.storageUri,
            createdBy: params.createdBy ?? null,
            createdAt: new Date('2024-01-01T00:10:00Z'),
            updatedAt: new Date('2024-01-01T00:10:00Z'),
          }),
        },
      },
    );

    expect(draft).not.toBeNull();
    expect(draft?.promptPackageId).toBe(promptPackage.id);
    expect(draft?.studentId).toBe('student-1');
    expect(draft?.createdBy).toBe('user-1');
    expect(draft?.storageUri).toContain('local://drafts/');
    expect(draft?.text).toBe('DRAFT TEXT');
  });

  it('returns null when prompt package is missing', async () => {
    const storage = createStorageStub();
    const insert = vi.fn();

    const draft = await createDraft(
      {
        promptPackageId: 'missing',
        text: 'DRAFT TEXT',
      },
      {
        storage,
        promptPackages: {
          getById: async () => null,
        },
        drafts: {
          insert,
        },
      },
    );

    expect(draft).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('materializes a draft and updates the job', async () => {
    const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-drafts-'));
    const draft: DraftRecord = {
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-1',
      storageUri: 'local://drafts/draft-1.md',
      createdBy: 'user-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    };

    const updateDraftLink = vi.fn().mockResolvedValue({
      id: 'job-1',
      state: 'awaiting_approval',
      md: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await materializeDraft(
      { draftId: draft.id, jobId: 'job-1' },
      {
        uploadDir,
        storage: createStorageStub({
          getText: async () => 'DRAFT TEXT',
        }),
        drafts: {
          getById: async () => draft,
        },
        jobs: {
          updateDraftLink,
        },
      },
    );

    expect(response).toEqual({
      draftId: 'draft-1',
      jobId: 'job-1',
      mdPath: path.resolve(uploadDir, 'drafts', 'draft-1.md'),
    });

    const stored = await fs.readFile(
      path.resolve(uploadDir, 'drafts', 'draft-1.md'),
      'utf8',
    );
    expect(stored).toBe('DRAFT TEXT');
    expect(updateDraftLink).toHaveBeenCalledWith({
      id: 'job-1',
      expectedState: 'awaiting_approval',
      md: path.resolve(uploadDir, 'drafts', 'draft-1.md'),
      draftId: 'draft-1',
    });
  });

  it('materializes a draft and creates an approval job when jobId is missing', async () => {
    const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-drafts-'));
    const draft: DraftRecord = {
      id: 'draft-2',
      promptPackageId: 'prompt-2',
      studentId: 'student-2',
      storageUri: 'local://drafts/draft-2.md',
      createdBy: 'user-2',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    };
    const promptPackage: PromptPackageRecord = {
      id: 'prompt-2',
      recordingId: 'recording-2',
      transcriptId: 'transcript-2',
      studentId: 'student-2',
      profilePath: '/profiles/p2.md',
      templateVersion: '/templates/t2.md',
      notes: 'Notes',
      storageUri: 'local://prompt-packages/prompt-2.txt',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    };

    const createApprovalJob = vi.fn().mockResolvedValue({
      id: 'job-2',
      state: 'awaiting_approval',
      md: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const updateDraftLink = vi.fn().mockResolvedValue({
      id: 'job-2',
      state: 'awaiting_approval',
      md: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await materializeDraft(
      { draftId: draft.id },
      {
        uploadDir,
        storage: createStorageStub({
          getText: async () => 'DRAFT TEXT',
        }),
        drafts: {
          getById: async () => draft,
        },
        promptPackages: {
          getById: async () => promptPackage,
        },
        createApprovalJob,
        jobs: {
          updateDraftLink,
        },
      },
    );

    expect(response).toEqual({
      draftId: 'draft-2',
      jobId: 'job-2',
      mdPath: path.resolve(uploadDir, 'drafts', 'draft-2.md'),
    });
    expect(createApprovalJob).toHaveBeenCalledWith({ draft, promptPackage });
    expect(updateDraftLink).toHaveBeenCalledWith({
      id: 'job-2',
      expectedState: 'awaiting_approval',
      md: path.resolve(uploadDir, 'drafts', 'draft-2.md'),
      draftId: 'draft-2',
    });
  });

  it('returns null when draft is missing during materialization', async () => {
    const response = await materializeDraft(
      { draftId: 'missing', jobId: 'job-1' },
      {
        uploadDir: '/tmp',
        storage: createStorageStub(),
        drafts: {
          getById: async () => null,
        },
        jobs: {
          updateDraftLink: vi.fn(),
        },
      },
    );

    expect(response).toBeNull();
  });

  it('materializes a draft and auto-publishes if requested', async () => {
    const drafts = { getById: vi.fn() };
    const promptPackages = { getById: vi.fn() };
    const createApprovalJob = vi.fn();
    const jobs = { updateDraftLink: vi.fn(), approveJob: vi.fn() };
    const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-drafts-'));
    const storage = { getText: vi.fn().mockResolvedValue('markdown content') };

    drafts.getById.mockResolvedValue({
      id: 'draft-1',
      storageUri: 'file:///tmp/draft.json',
      promptPackageId: 'pp-1',
    });

    promptPackages.getById.mockResolvedValue({
      recordingId: 'rec-1',
      transcriptId: 'tx-1'
    });

    jobs.updateDraftLink.mockResolvedValue({ id: 'job-1' });

    await materializeDraft(
      { draftId: 'draft-1', jobId: 'job-1', jobOverrides: { autoPublish: true } },
      // @ts-expect-error - partial mocks
      { drafts, promptPackages, createApprovalJob, jobs, uploadDir, storage },
    );

    expect(jobs.approveJob).toHaveBeenCalledWith({
      id: 'job-1',
      expectedState: 'awaiting_approval',
      md: path.resolve(uploadDir, 'drafts', 'draft-1.md'),
    });
  });
});

function createStorageStub(
  overrides: Partial<TranscriptionStorage> = {},
): TranscriptionStorage {
  return {
    putAudio: async () => ({ uri: 'local://recordings/recording.opus', bytes: 1 }),
    putTranscript: async () => ({ uri: 'local://transcripts/transcript.txt', bytes: 1 }),
    putRawResponse: async () => ({ uri: 'local://transcripts/transcript.json', bytes: 1 }),
    putPromptPackage: async () => ({ uri: 'local://prompt-packages/prompt.txt', bytes: 1 }),
    putDraft: async () => ({ uri: 'local://drafts/draft.md', bytes: 1 }),
    getText: async () => '',
    getStream: async () => Readable.from(['']),
    delete: async () => { },
    ...overrides,
  };
}
