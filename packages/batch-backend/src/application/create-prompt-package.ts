import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import { insertPromptPackage } from '../domain/prompt-package-repository.js';
import {
  getLatestProfileRevisionByHash,
  insertProfileRevision,
} from '../domain/profile-revision-repository.js';
import {
  getLatestTemplateRevisionByHash,
  insertTemplateRevision,
} from '../domain/template-revision-repository.js';
import { getRecordingById } from '../domain/recording-repository.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  createTranscriptionStorage,
  createTranscriptionStorageForUri,
} from '../infrastructure/transcription-storage.js';
import { stitchPromptPayload } from './prompt-assembly.js';
import { resolvePromptSelection } from './prompt-options.js';
import { getStudentProfileById } from './student-profiles-store.js';

export interface CreatePromptPackageParams {
  recordingId: string;
  notes?: string | null;
  profilePath?: string | null;
  profileId?: string | null;
  templateId?: string | null;
}

export interface PromptPackageResponse {
  id: string;
  recordingId: string;
  transcriptId: string;
  studentId: string | null;
  profilePath: string | null;
  templateVersion: string;
  notes: string | null;
  storageUri: string;
  text: string;
  profileSnapshot?: {
    resolvedProfileId: string;
    resolvedProfileHash: string;
    resolvedProfileRevisionId: string | null;
    resolvedProfileUpdatedAt: string | null;
  };
  templateSnapshot?: {
    resolvedTemplateId: string;
    resolvedTemplateHash: string;
    resolvedTemplateRevisionId: string | null;
    resolvedTemplateUpdatedAt: string | null;
  };
  profileDrift?: {
    detected: true;
    reason: 'profile_missing' | 'profile_content_changed';
    currentProfileHash: string | null;
    currentProfileRevisionId: string | null;
    currentProfileUpdatedAt: string | null;
  };
  templateDrift?: {
    detected: true;
    reason: 'template_missing' | 'template_content_changed';
    currentTemplateHash: string | null;
    currentTemplateRevisionId: string | null;
    currentTemplateUpdatedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptPackageDependencies {
  config: BatchBackendConfig;
  storage: TranscriptionStorage;
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
  };
  recordings: {
    getById: typeof getRecordingById;
  };
  students: {
    getById: typeof getStudentProfileById;
  };
  promptPackages: {
    insert: typeof insertPromptPackage;
  };
  profileRevisions: {
    getLatestByHash: typeof getLatestProfileRevisionByHash;
    insert: typeof insertProfileRevision;
  };
  templateRevisions: {
    getLatestByHash: typeof getLatestTemplateRevisionByHash;
    insert: typeof insertTemplateRevision;
  };
}

export async function createPromptPackage(
  params: CreatePromptPackageParams,
  overrides?: Partial<CreatePromptPackageDependencies>,
): Promise<PromptPackageResponse | null> {
  if (!params.recordingId) return null;

  const config = overrides?.config ?? loadConfig();
  const storage = overrides?.storage ?? createTranscriptionStorage();
  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingId,
  };
  const recordings = overrides?.recordings ?? {
    getById: getRecordingById,
  };
  const students = overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const promptPackages = overrides?.promptPackages ?? {
    insert: insertPromptPackage,
  };
  const profileRevisions = overrides?.profileRevisions ?? {
    getLatestByHash: getLatestProfileRevisionByHash,
    insert: insertProfileRevision,
  };
  const templateRevisions = overrides?.templateRevisions ?? {
    getLatestByHash: getLatestTemplateRevisionByHash,
    insert: insertTemplateRevision,
  };

  const transcript = await transcripts.getByRecordingId(params.recordingId);
  if (!transcript) return null;
  const recording = await recordings.getById(transcript.recordingId);

  let studentProfileId: string | null = null;
  if (recording?.studentId) {
    const studentProfile = await students.getById(recording.studentId, { config });
    studentProfileId = studentProfile?.profileId ?? null;
  }

  const fallbackProfileId =
    params.profileId ?? (params.profilePath ? undefined : (studentProfileId ?? undefined));

  const selection = await resolvePromptSelection(
    {
      templateId: params.templateId,
      profileId: fallbackProfileId,
      profilePath: params.profilePath,
    },
    { config },
  );
  const templatePath = selection.templatePath;
  const profilePath = selection.profilePath;
  const readStorage = overrides?.storage ?? createTranscriptionStorageForUri(transcript.storageUri);
  const [template, profile, transcriptText] = await Promise.all([
    fs.readFile(templatePath, 'utf8'),
    fs.readFile(profilePath, 'utf8'),
    readStorage.getText(transcript.storageUri),
  ]);

  const payload = stitchPromptPayload({
    template,
    profile,
    transcript: transcriptText,
    notes: params.notes,
  });
  const templateHash = hashContent(template);
  const profileHash = hashProfileContent(profile);
  const existingTemplateRevision = await templateRevisions.getLatestByHash(
    selection.templateId,
    templateHash,
  );
  const templateRevision =
    existingTemplateRevision ??
    (await templateRevisions.insert({
      templateId: selection.templateId,
      content: template,
      contentHash: templateHash,
      source: 'update',
      createdBy: null,
      restoredFromRevisionId: null,
    }));
  const existingRevision = await profileRevisions.getLatestByHash(selection.profileId, profileHash);
  const profileRevision =
    existingRevision ??
    (await profileRevisions.insert({
      profileId: selection.profileId,
      content: profile,
      contentHash: profileHash,
      source: 'update',
      createdBy: null,
      restoredFromRevisionId: null,
    }));

  const promptPackageId = randomUUID();
  const stored = await storage.putPromptPackage({
    promptPackageId,
    text: payload,
  });

  const promptPackage = await promptPackages.insert({
    id: promptPackageId,
    recordingId: transcript.recordingId,
    transcriptId: transcript.id,
    studentId: recording?.studentId ?? null,
    profilePath,
    resolvedProfileId: selection.profileId,
    resolvedProfileHash: profileHash,
    resolvedProfileRevisionId: profileRevision.id,
    resolvedProfileUpdatedAt: profileRevision.createdAt,
    resolvedTemplateId: selection.templateId,
    resolvedTemplateHash: templateHash,
    resolvedTemplateRevisionId: templateRevision.id,
    resolvedTemplateUpdatedAt: templateRevision.createdAt,
    templateVersion: selection.templateId,
    notes: params.notes ?? null,
    storageUri: stored.uri,
  });

  return toPromptPackageResponse(promptPackage, payload);
}

export function toPromptPackageResponse(
  promptPackage: PromptPackageRecord,
  text: string,
): PromptPackageResponse {
  const hasProfileSnapshot =
    typeof promptPackage.resolvedProfileId === 'string' &&
    promptPackage.resolvedProfileId.length > 0 &&
    typeof promptPackage.resolvedProfileHash === 'string' &&
    promptPackage.resolvedProfileHash.length > 0;
  const hasTemplateSnapshot =
    typeof promptPackage.resolvedTemplateId === 'string' &&
    promptPackage.resolvedTemplateId.length > 0 &&
    typeof promptPackage.resolvedTemplateHash === 'string' &&
    promptPackage.resolvedTemplateHash.length > 0;

  return {
    id: promptPackage.id,
    recordingId: promptPackage.recordingId,
    transcriptId: promptPackage.transcriptId,
    studentId: promptPackage.studentId ?? null,
    profilePath: promptPackage.profilePath ?? null,
    templateVersion: promptPackage.templateVersion,
    notes: promptPackage.notes ?? null,
    storageUri: promptPackage.storageUri,
    text,
    ...(hasProfileSnapshot
      ? {
          profileSnapshot: {
            resolvedProfileId: promptPackage.resolvedProfileId as string,
            resolvedProfileHash: promptPackage.resolvedProfileHash as string,
            resolvedProfileRevisionId: promptPackage.resolvedProfileRevisionId ?? null,
            resolvedProfileUpdatedAt: promptPackage.resolvedProfileUpdatedAt
              ? promptPackage.resolvedProfileUpdatedAt.toISOString()
              : null,
          },
        }
      : {}),
    ...(hasTemplateSnapshot
      ? {
          templateSnapshot: {
            resolvedTemplateId: promptPackage.resolvedTemplateId as string,
            resolvedTemplateHash: promptPackage.resolvedTemplateHash as string,
            resolvedTemplateRevisionId: promptPackage.resolvedTemplateRevisionId ?? null,
            resolvedTemplateUpdatedAt: promptPackage.resolvedTemplateUpdatedAt
              ? promptPackage.resolvedTemplateUpdatedAt.toISOString()
              : null,
          },
        }
      : {}),
    createdAt: promptPackage.createdAt.toISOString(),
    updatedAt: promptPackage.updatedAt.toISOString(),
  };
}

function hashProfileContent(content: string): string {
  return hashContent(content);
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
