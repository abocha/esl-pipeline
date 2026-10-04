import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseAssignmentV1, serializeAssignmentV1 } from '@esl-pipeline/contracts';

import {
  assignmentContext,
  assignmentHash,
  draftArtifact,
  readValidatedAssignment,
} from '../src/application/assignment-artifact.js';
import { createDraft } from '../src/application/create-draft.js';
import { getDraft } from '../src/application/get-draft.js';
import { materializeDraft } from '../src/application/materialize-draft.js';
import { updateDraft } from '../src/application/update-draft.js';
import type { DraftRecord } from '../src/domain/draft-model.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import { FilesystemTranscriptionStorage } from '../src/infrastructure/transcription-storage.js';
import { assignmentFixture, promptPackageFixture } from './assignment-v1.test-harness.js';

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-assignment-authority-'));
  directories.push(dir);
  const storage = new FilesystemTranscriptionStorage(dir);
  const prompt = {
    ...promptPackageFixture(),
    studentId: 'student-1',
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
  } as unknown as PromptPackageRecord;
  let durable: DraftRecord | undefined;
  const insert = vi.fn(async (params) => {
    durable = { ...params, createdAt: new Date(), updatedAt: new Date() };
    return durable!;
  });
  const update = vi.fn(async (params) => {
    if (params.expectedWorkingVersion !== durable!.workingVersion) throw new Error('CAS conflict');
    durable = { ...durable!, ...params, workingVersion: durable!.workingVersion! + 1 };
    return durable!;
  });
  const prompts = {
    getById: vi.fn(async () => prompt),
    isSourceCanonical: vi.fn(async () => true),
  };
  const created = await createDraft(
    { promptPackageId: prompt.id, text: JSON.stringify(assignmentFixture(), null, 4) },
    { storage, promptPackages: prompts, drafts: { insert } },
  );
  return {
    storage,
    prompt,
    prompts,
    created: created!,
    get durable() {
      return durable!;
    },
    update,
    insert,
  };
}

describe('durable AssignmentV1 authority', () => {
  it('rejects materializing a typed draft into a legacy job before writing or relinking', async () => {
    const f = await fixture();
    const put = vi.spyOn(f.storage, 'putDraft');
    const link = vi.fn();
    await expect(
      materializeDraft(
        { draftId: f.created.id, jobId: 'legacy-job' },
        {
          storage: f.storage,
          drafts: { getById: async () => f.durable },
          promptPackages: f.prompts,
          localExport: false,
          jobs: {
            getById: async () =>
              ({ id: 'legacy-job', state: 'awaiting_approval', assignmentArtifact: null }) as never,
            updateDraftLink: link,
          },
        },
      ),
    ).rejects.toThrow('Assignment job authority format mismatch');
    expect(put).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it('writes only canonical JSON, preserves array order, and resumes the last valid artifact', async () => {
    const f = await fixture();
    expect(f.created).toMatchObject({
      format: 'assignment_v1',
      assignment: assignmentFixture(),
      artifact: { schemaVersion: 1, serializationVersion: 1, workingVersion: 1 },
    });
    const stored = await f.storage.getText(f.created.storageUri);
    expect(stored).toBe(serializeAssignmentV1(assignmentFixture()));
    expect(f.created.storageUri).toContain(`${assignmentHash(assignmentFixture())}.json`);
    expect(assignmentHash(parseAssignmentV1(JSON.stringify(assignmentFixture(), null, 8)))).toBe(
      f.created.contentHash,
    );
    const resumed = await getDraft(f.created.id, {
      storage: f.storage,
      drafts: { getById: async () => f.durable },
      promptPackages: f.prompts,
    });
    expect(resumed?.assignment).toEqual(assignmentFixture());
    expect(resumed?.text).toContain('\n  "schemaVersion": 1');
  });

  it.each([
    ['syntax', '{', 'syntax error'],
    [
      'schema path',
      JSON.stringify({ ...assignmentFixture(), metadata: { title: 1 } }),
      'metadata.title',
    ],
    [
      'domain',
      JSON.stringify({ ...assignmentFixture(), practice: [] }),
      'practice must not be empty',
    ],
    [
      'student grounding',
      JSON.stringify({
        ...assignmentFixture(),
        metadata: { ...assignmentFixture().metadata, student: 'Other learner' },
      }),
      'canonical student',
    ],
  ])('rejects %s before any durable write', async (_kind, text, error) => {
    const f = await fixture();
    const put = vi.spyOn(f.storage, 'putDraft');
    await expect(
      updateDraft(
        { id: f.created.id, text, expectedWorkingVersion: 1 },
        {
          storage: f.storage,
          drafts: { getById: async () => f.durable, update: f.update },
          promptPackages: f.prompts,
        },
      ),
    ).rejects.toThrow(error);
    expect(put).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.durable.contentHash).toBe(f.created.contentHash);
  });

  it('rejects an invalid create and a displaced source before writing', async () => {
    const f = await fixture();
    const put = vi.spyOn(f.storage, 'putDraft');
    await expect(
      createDraft(
        { promptPackageId: f.prompt.id, text: '# Markdown cannot be the authority' },
        { storage: f.storage, promptPackages: f.prompts, drafts: { insert: f.insert } },
      ),
    ).rejects.toThrow('syntax');
    f.prompts.isSourceCanonical.mockResolvedValue(false);
    await expect(
      updateDraft(
        { id: f.created.id, text: f.created.text, expectedWorkingVersion: 1 },
        {
          storage: f.storage,
          promptPackages: f.prompts,
          drafts: { getById: async () => f.durable, update: f.update },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL' });
    expect(put).not.toHaveBeenCalled();
  });

  it('freezes canonical input after a later edit and detects corruption', async () => {
    const f = await fixture();
    const frozen = draftArtifact(f.durable)!;
    const edited = assignmentFixture();
    edited.metadata.title = 'Later assignment';
    await updateDraft(
      { id: f.created.id, text: JSON.stringify(edited), expectedWorkingVersion: 1 },
      {
        storage: f.storage,
        promptPackages: f.prompts,
        drafts: { getById: async () => f.durable, update: f.update },
      },
    );
    const link = vi.fn(async () => ({ id: 'job-1' }) as never);
    const materialized = await materializeDraft(
      {
        draftId: f.created.id,
        jobId: 'job-1',
        sourceStorageUri: frozen.storageUri,
        expectedContentHash: frozen.contentHash,
      },
      {
        storage: f.storage,
        drafts: { getById: async () => f.durable },
        promptPackages: f.prompts,
        localExport: false,
        jobs: {
          getById: async () =>
            ({
              id: 'job-1',
              draftId: f.created.id,
              promptPackageId: f.prompt.id,
              state: 'awaiting_approval',
              assignmentArtifact: frozen,
              assignmentRendererVersion: 2,
            }) as never,
          updateDraftLink: link,
        },
      },
    );
    expect(materialized?.mdStorageUri).toBe(frozen.storageUri);
    expect(await f.storage.getText(materialized!.mdStorageUri)).toBe(
      serializeAssignmentV1(assignmentFixture()),
    );
    expect(await readValidatedAssignment(frozen, assignmentContext(f.prompt), f.storage)).toEqual(
      assignmentFixture(),
    );
    await fs.writeFile(
      path.join(directories.at(-1)!, frozen.storageUri.slice('local://'.length)),
      serializeAssignmentV1(edited),
    );
    await expect(
      readValidatedAssignment(frozen, assignmentContext(f.prompt), f.storage),
    ).rejects.toThrow('content hash mismatch');
  });
});
