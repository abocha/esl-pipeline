import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { BatchBackendConfig } from '../src/config/env.js';
import type { ProfileRevisionRecord } from '../src/domain/profile-revision-model.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import type { InsertPromptPackageParams } from '../src/domain/prompt-package-repository.js';
import type { TemplateRevisionRecord } from '../src/domain/template-revision-model.js';
import type { TranscriptRecord } from '../src/domain/transcript-model.js';
import type { TranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

export function createTranscriptRecord(): TranscriptRecord {
  return {
    id: 'transcript-1',
    recordingId: 'recording-1',
    storageUri: 'local://transcripts/transcript-1.txt',
    workingVersion: 1,
    contentHash: 'transcript-hash',
    rawResponseUri: null,
    mode: 'timeline',
    model: 'nova-3',
    language: 'en',
    sttProvider: 'deepgram',
    fallbackUsed: false,
    summaryJson: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
}

export function createStorageStub(
  overrides: Partial<TranscriptionStorage> = {},
): TranscriptionStorage {
  return {
    putAudio: async () => ({ uri: 'local://recordings/recording.opus', bytes: 1, sha256: 'hash' }),
    putTranscript: async () => ({
      uri: 'local://transcripts/transcript-1.txt',
      bytes: 1,
      sha256: 'hash',
    }),
    putRawResponse: async () => ({
      uri: 'local://transcripts/transcript-1.json',
      bytes: 1,
      sha256: 'hash',
    }),
    putPromptPackage: async () => ({
      uri: 'local://prompt-packages/prompt-1.txt',
      bytes: 1,
      sha256: 'hash',
    }),
    putDraft: async () => ({ uri: 'local://drafts/draft-1.md', bytes: 1, sha256: 'hash' }),
    getText: async () => '',
    getStream: async () => Readable.from(['']),
    delete: async () => {},
    ...overrides,
  };
}

export function createPromptPackageRepositoryStub() {
  return {
    insert: async (params: InsertPromptPackageParams): Promise<PromptPackageRecord> => ({
      id: params.id ?? 'prompt-1',
      recordingId: params.recordingId,
      transcriptId: params.transcriptId,
      studentId: params.studentId ?? null,
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
    }),
  };
}

function createDefaultProfileRevision(studentId: string): ProfileRevisionRecord {
  const content = 'PROFILE CONTENT\n';
  return {
    id: `active-${studentId}`,
    studentId,
    content,
    contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
    source: 'update',
    status: 'active',
    versionNumber: 1,
    versionLabel: 'v1',
    activatedAt: new Date('2024-01-01T00:00:00Z'),
    deprecatedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    createdBy: null,
    restoredFromRevisionId: null,
  };
}

export function createProfileRevisionRepositoryStub(
  overrides: {
    getActive?: (studentId: string) => Promise<ProfileRevisionRecord | null>;
    getById?: (studentId: string, revisionId: string) => Promise<ProfileRevisionRecord | null>;
    getLatestByHash?: (
      studentId: string,
      contentHash: string,
    ) => Promise<ProfileRevisionRecord | null>;
  } = {},
) {
  return {
    getActive:
      overrides.getActive ?? (async (studentId: string) => createDefaultProfileRevision(studentId)),
    getById:
      overrides.getById ??
      (async (studentId: string, revisionId: string) => {
        return { ...createDefaultProfileRevision(studentId), id: revisionId };
      }),
    getRecorded: async (studentId: string, revisionId: string, contentHash: string) => {
      const revision = await (
        overrides.getById ?? (async (id: string) => createDefaultProfileRevision(id))
      )(studentId, revisionId);
      return revision?.contentHash === contentHash ? revision : null;
    },
    getLatestByHash: overrides.getLatestByHash ?? (async () => null),
    activate: async (
      _studentId: string,
      _revisionId: string,
    ): Promise<ProfileRevisionRecord | null> => null,
    insert: async ({
      studentId,
      content,
      contentHash,
      source,
      createdBy,
      restoredFromRevisionId,
    }: {
      studentId: string;
      content: string;
      contentHash: string;
      source?: 'create' | 'update' | 'restore';
      createdBy?: string | null;
      restoredFromRevisionId?: string | null;
    }) => {
      const revision: ProfileRevisionRecord = {
        id: 'revision-1',
        studentId,
        content,
        contentHash,
        source: source ?? 'update',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: new Date('2024-01-01T00:00:00Z'),
        deprecatedAt: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        createdBy: createdBy ?? null,
        restoredFromRevisionId: restoredFromRevisionId ?? null,
      };
      return revision;
    },
  };
}

export function createTemplateRevisionRepositoryStub(
  overrides: {
    getActive?: (templateId: string) => Promise<TemplateRevisionRecord | null>;
    getLatestByHash?: (
      templateId: string,
      contentHash: string,
    ) => Promise<TemplateRevisionRecord | null>;
  } = {},
) {
  return {
    getActive:
      overrides.getActive ??
      (async (templateId: string) => {
        const contentByTemplateId: Record<string, string> = {
          'hw_prompt_assignment_v1.md': [
            'Assignment output contract: assignment_v1_generation_v5',
            'Header',
            'Use descriptive speaker profiles with stable role and persona text.',
          ].join('\n'),
        };
        const content =
          contentByTemplateId[templateId] ??
          'Assignment output contract: assignment_v1_generation_v5\nHello\nFooter\n';
        return {
          id: `active-${templateId}`,
          templateId,
          content,
          contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
          source: 'update',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: new Date('2024-01-01T00:00:00Z'),
          deprecatedAt: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          createdBy: null,
          restoredFromRevisionId: null,
        } satisfies TemplateRevisionRecord;
      }),
    getLatestByHash: overrides.getLatestByHash ?? (async () => null),
    activate: async (
      _templateId: string,
      _revisionId: string,
    ): Promise<TemplateRevisionRecord | null> => null,
    insert: async ({
      templateId,
      content,
      contentHash,
      source,
      createdBy,
      restoredFromRevisionId,
    }: {
      templateId: string;
      content: string;
      contentHash: string;
      source?: 'create' | 'update' | 'restore';
      createdBy?: string | null;
      restoredFromRevisionId?: string | null;
    }) => {
      const revision: TemplateRevisionRecord = {
        id: 'template-revision-1',
        templateId,
        content,
        contentHash,
        source: source ?? 'update',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: new Date('2024-01-01T00:00:00Z'),
        deprecatedAt: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        createdBy: createdBy ?? null,
        restoredFromRevisionId: restoredFromRevisionId ?? null,
      };
      return revision;
    },
  };
}

export function createPromptOptionsStub(
  options: { strictAllowlist?: boolean; allowedTemplateIds?: string[] } = {},
) {
  return {
    resolveTemplateSelection: async (
      params: { templateId?: string | null },
      overrides?: Partial<{ config: BatchBackendConfig }>,
    ) => {
      const config = overrides?.config;
      if (!config) throw new Error('config is required');
      const defaultTemplateId = path.basename(config.prompt.templatePath).replaceAll('\\', '/');
      const templateId = params.templateId ?? defaultTemplateId;
      if (
        options.strictAllowlist &&
        !new Set([defaultTemplateId, ...(options.allowedTemplateIds ?? [])]).has(templateId)
      ) {
        throw new Error('templateId is not allowlisted');
      }
      return { templateId };
    },
  };
}

export function createConfig(templatePath: string, _legacyProfilePath: string): BatchBackendConfig {
  return {
    prompt: {
      templatePath,
    },
  } as BatchBackendConfig;
}
