import { describe, expect, it, vi } from 'vitest';

import { serializeAssignmentV1 } from '@esl-pipeline/contracts';

import { assignmentHash } from '../src/application/assignment-artifact.js';
import { createDraft } from '../src/application/create-draft.js';
import { materializeDraft } from '../src/application/materialize-draft.js';
import { updateDraft } from '../src/application/update-draft.js';
import { assignmentFixture, promptPackageFixture } from './assignment-v1.test-harness.js';

describe('draft execution boundaries', () => {
  it('rejects historical creation, update and materialization before storing or relinking', async () => {
    const putDraft = vi.fn(),
      insert = vi.fn(),
      update = vi.fn(),
      createApprovalJob = vi.fn(),
      link = vi.fn(),
      read = vi.fn();
    const legacy = {
      id: 'legacy',
      promptPackageId: 'old-prompt',
      format: 'markdown',
      storageUri: 'local://history/original.md',
    };
    const storage = { putDraft, getText: read } as never;
    const prompts = {
      getById: vi.fn().mockResolvedValue({ id: 'old-prompt' }),
      isSourceCanonical: vi.fn().mockResolvedValue(true),
    };
    await expect(
      createDraft(
        { promptPackageId: 'old-prompt', text: '# Original' },
        { storage, promptPackages: prompts, drafts: { insert } },
      ),
    ).rejects.toMatchObject({ code: 'legacy_assignment_read_only' });
    await expect(
      updateDraft(
        { id: 'legacy', text: '# Changed', expectedWorkingVersion: 1 },
        { storage, drafts: { getById: vi.fn().mockResolvedValue(legacy), update } },
      ),
    ).rejects.toMatchObject({ code: 'legacy_assignment_read_only' });
    await expect(
      materializeDraft(
        { draftId: 'legacy' },
        {
          storage,
          drafts: { getById: vi.fn().mockResolvedValue(legacy) },
          createApprovalJob,
          jobs: { updateDraftLink: link },
        },
      ),
    ).rejects.toMatchObject({ code: 'legacy_assignment_read_only' });
    for (const operation of [putDraft, insert, update, createApprovalJob, link, read])
      expect(operation).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'materializes canonical typed input into a new job with autoPublish=%s',
    async (autoPublish) => {
      const assignment = assignmentFixture(),
        hash = assignmentHash(assignment);
      const uri = `local://drafts/content/${hash}.json`;
      const draft = {
        id: 'draft',
        promptPackageId: 'prompt-1',
        format: 'assignment_v1',
        workingVersion: 1,
        contentHash: hash,
        storageUri: uri,
      };
      const prompt = promptPackageFixture();
      const createApprovalJob = vi.fn().mockResolvedValue({ id: 'native-job' }),
        link = vi.fn().mockResolvedValue({ id: 'native-job' }),
        approve = vi.fn().mockResolvedValue({ id: 'native-job' });
      const result = await materializeDraft(
        { draftId: 'draft', jobOverrides: { autoPublish, learningPresetId: 'general-english' } },
        {
          storage: {
            getText: vi.fn().mockResolvedValue(serializeAssignmentV1(assignment)),
          } as never,
          drafts: { getById: vi.fn().mockResolvedValue(draft) },
          promptPackages: {
            getById: vi.fn().mockResolvedValue(prompt),
            isSourceCanonical: vi.fn().mockResolvedValue(true),
          },
          createApprovalJob,
          jobs: { updateDraftLink: link },
          approvals: { approveForPipeline: approve },
        },
      );
      expect(createApprovalJob).toHaveBeenCalledWith({
        draft,
        promptPackage: prompt,
        jobOverrides: { autoPublish, learningPresetId: 'general-english' },
      });
      expect(result).toEqual({
        draftId: 'draft',
        jobId: 'native-job',
        mdPath: null,
        mdStorageUri: uri,
      });
      expect(approve).toHaveBeenCalledTimes(autoPublish ? 1 : 0);
    },
  );

  it('rejects displaced native source authority before reading, creating or publishing', async () => {
    const read = vi.fn(),
      createApprovalJob = vi.fn(),
      publish = vi.fn();
    await expect(
      materializeDraft(
        { draftId: 'draft', jobOverrides: { autoPublish: true } },
        {
          drafts: {
            getById: vi
              .fn()
              .mockResolvedValue({
                id: 'draft',
                promptPackageId: 'prompt-1',
                format: 'assignment_v1',
                workingVersion: 1,
                contentHash: 'a'.repeat(64),
                storageUri: `local://drafts/content/${'a'.repeat(64)}.json`,
              }),
          },
          promptPackages: {
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
            isSourceCanonical: vi.fn().mockResolvedValue(false),
          },
          storage: { getText: read } as never,
          createApprovalJob,
          approvals: { approveForPipeline: publish },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL' });
    for (const operation of [read, createApprovalJob, publish])
      expect(operation).not.toHaveBeenCalled();
  });
});
