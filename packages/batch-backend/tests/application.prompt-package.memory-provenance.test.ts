import { describe, expect, it } from 'vitest';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import type { InsertPromptPackageParams } from '../src/domain/prompt-package-repository.js';
import {
  createBindingResolverStub,
  createConfig,
  createProfileRevisionRepositoryStub,
  createPromptOptionsStub,
  createStorageStub,
  createTemplateRevisionRepositoryStub,
  createTranscriptRecord,
} from './application.prompt-package.test-harness.js';

describe('application/prompt-package memory provenance', () => {
  it('does not label retrieval policy as student-memory-v1 when history falls back to legacy or none', async () => {
    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
      putPromptPackage: async ({ promptPackageId }) => ({
        uri: `local://prompt-packages/${promptPackageId}.txt`,
        bytes: 1,
        sha256: 'hash',
      }),
    });

    const insertedParams: InsertPromptPackageParams[] = [];
    const promptPackages = {
      insert: async (params: InsertPromptPackageParams): Promise<PromptPackageRecord> => {
        insertedParams.push(params);
        return {
          id: params.id ?? 'prompt-1',
          recordingId: params.recordingId,
          transcriptId: params.transcriptId,
          studentId: params.studentId ?? null,
          studentMemorySnapshotId: params.studentMemorySnapshotId ?? null,
          studentMemorySnapshotHash: params.studentMemorySnapshotHash ?? null,
          selectedLessonMemoryIds: params.selectedLessonMemoryIds ?? [],
          selectedHomeworkMemoryIds: params.selectedHomeworkMemoryIds ?? [],
          retrievalPolicyVersion: params.retrievalPolicyVersion ?? null,
          profilePath: params.profilePath ?? null,
          resolvedProfileId: params.resolvedProfileId ?? null,
          resolvedProfileHash: params.resolvedProfileHash ?? null,
          resolvedProfileRevisionId: params.resolvedProfileRevisionId ?? null,
          resolvedProfileUpdatedAt: params.resolvedProfileUpdatedAt ?? null,
          resolvedTemplateId: params.resolvedTemplateId ?? null,
          resolvedTemplateHash: params.resolvedTemplateHash ?? null,
          resolvedTemplateRevisionId: params.resolvedTemplateRevisionId ?? null,
          resolvedTemplateUpdatedAt: params.resolvedTemplateUpdatedAt ?? null,
          templateVersion: params.templateVersion,
          notes: params.notes ?? null,
          storageUri: params.storageUri,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        };
      },
    };

    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
        profileId: 'profile.md',
      },
      {
        config: createConfig('/tmp/template.md', '/tmp/profile.md'),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => ({
            id: transcript.recordingId,
            source: 'upload',
            studentId: 'student-1',
            sourcePath: null,
            storageUri: 'local://recordings/recording-1.opus',
            sha256: null,
            bytes: 1,
            durationSec: null,
            channels: null,
            status: 'transcribed',
            error: null,
            createdAt: new Date('2024-01-01T00:00:00Z'),
            updatedAt: new Date('2024-01-01T00:00:00Z'),
          }),
        },
        students: {
          getById: async () => null,
        },
        promptPackages,
        profileRevisions: createProfileRevisionRepositoryStub(),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
        lessonMemory: {
          requestGeneration: async () => null,
        },
      },
    );

    expect(insertedParams[0]?.retrievalPolicyVersion ?? null).toBeNull();
    expect(result?.memory.retrievalPolicyVersion ?? null).toBeNull();
  });
});
