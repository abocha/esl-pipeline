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

export function createProfileRevisionRepositoryStub(
  overrides: {
    getActive?: (profileId: string) => Promise<ProfileRevisionRecord | null>;
    getLatestByHash?: (
      profileId: string,
      contentHash: string,
    ) => Promise<ProfileRevisionRecord | null>;
  } = {},
) {
  return {
    getActive:
      overrides.getActive ??
      (async (profileId: string) => {
        const contentByProfileId: Record<string, string> = {
          'profile.md': 'PROFILE CONTENT\n',
          'profiles/student-a.md': 'STUDENT PROFILE CONTENT\n',
          'profiles/explicit.md': 'EXPLICIT PROFILE CONTENT\n',
          'profiles/bound.md': 'BOUND PROFILE CONTENT\n',
          'default-profile.md': 'DEFAULT PROFILE\n',
        };
        const content = contentByProfileId[profileId] ?? 'PROFILE CONTENT\n';
        return {
          id: `active-${profileId}`,
          profileId,
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
        } satisfies ProfileRevisionRecord;
      }),
    getLatestByHash: overrides.getLatestByHash ?? (async () => null),
    activate: async (
      _profileId: string,
      _revisionId: string,
    ): Promise<ProfileRevisionRecord | null> => null,
    insert: async ({
      profileId,
      content,
      contentHash,
      source,
      createdBy,
      restoredFromRevisionId,
    }: {
      profileId: string;
      content: string;
      contentHash: string;
      source?: 'create' | 'update' | 'restore';
      createdBy?: string | null;
      restoredFromRevisionId?: string | null;
    }) => {
      const revision: ProfileRevisionRecord = {
        id: 'revision-1',
        profileId,
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
          'template.md': 'Hello\nFooter\n',
          'hw_prompt_definitive.md': [
            'Header',
            'Use descriptive speaker profiles with stable role and persona text.',
          ].join('\n'),
        };
        const content = contentByTemplateId[templateId] ?? 'Hello\nFooter\n';
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

export function createBindingResolverStub() {
  return {
    resolveAt: async () => null,
  };
}

export function createPromptOptionsStub(
  options: {
    strictAllowlist?: boolean;
    allowedTemplateIds?: string[];
    allowedProfileIds?: string[];
  } = {},
) {
  return {
    resolveSelection: async (
      params: {
        templateId?: string | null;
        profileId?: string | null;
        profilePath?: string | null;
      },
      overrides?: Partial<{ config: BatchBackendConfig }>,
    ) => {
      const config = overrides?.config;
      if (!config) throw new Error('config is required');

      const defaultTemplateId = path.basename(config.prompt.templatePath).replaceAll('\\', '/');
      const defaultProfileId = path
        .basename(config.prompt.defaultProfilePath)
        .replaceAll('\\', '/');

      const allowedTemplateIds = new Set([
        defaultTemplateId,
        ...(options.allowedTemplateIds ?? []),
      ]);
      const allowedProfileIds = new Set([defaultProfileId, ...(options.allowedProfileIds ?? [])]);

      const templateId = params.templateId ?? defaultTemplateId;
      if (options.strictAllowlist && !allowedTemplateIds.has(templateId)) {
        throw new Error('templateId is not allowlisted');
      }

      let profileId = params.profileId ?? null;
      if (!profileId && params.profilePath) {
        const profileRoot = path.dirname(path.resolve(config.prompt.defaultProfilePath));
        const candidate = path.isAbsolute(params.profilePath)
          ? path.resolve(params.profilePath)
          : path.resolve(profileRoot, params.profilePath);

        if (!isWithinRoot(profileRoot, candidate)) {
          throw new Error('profilePath must resolve within the configured profile root');
        }

        profileId = path.relative(profileRoot, candidate).split(path.sep).join('/');
      }

      const resolvedProfileId = profileId ?? defaultProfileId;
      if (options.strictAllowlist && !allowedProfileIds.has(resolvedProfileId)) {
        throw new Error('profileId is not allowlisted');
      }

      return {
        templateId,
        profileId: resolvedProfileId,
        profilePath: resolvedProfileId,
      };
    },
  };
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function createConfig(templatePath: string, profilePath: string): BatchBackendConfig {
  return {
    prompt: {
      templatePath,
      defaultProfilePath: profilePath,
    },
  } as BatchBackendConfig;
}
