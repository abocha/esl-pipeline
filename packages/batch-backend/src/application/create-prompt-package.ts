import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import { insertPromptPackage } from '../domain/prompt-package-repository.js';
import {
  activateProfileRevision,
  getLatestProfileRevisionByHash,
  insertProfileRevision,
} from '../domain/profile-revision-repository.js';
import { setProfileActiveRevision, upsertProfile } from '../domain/profile-repository.js';
import {
  activateTemplateRevision,
  getLatestTemplateRevisionByHash,
  insertTemplateRevision,
} from '../domain/template-revision-repository.js';
import { setTemplateActiveRevision, upsertTemplate } from '../domain/template-repository.js';
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
    resolvedProfileVersionLabel: string | null;
    resolvedProfileStatus: 'draft' | 'active' | 'deprecated' | null;
  };
  templateSnapshot?: {
    resolvedTemplateId: string;
    resolvedTemplateHash: string;
    resolvedTemplateRevisionId: string | null;
    resolvedTemplateUpdatedAt: string | null;
    resolvedTemplateVersionLabel: string | null;
    resolvedTemplateStatus: 'draft' | 'active' | 'deprecated' | null;
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
    activate: typeof activateProfileRevision;
    getLatestByHash: typeof getLatestProfileRevisionByHash;
    insert: typeof insertProfileRevision;
  };
  templateRevisions: {
    activate: typeof activateTemplateRevision;
    getLatestByHash: typeof getLatestTemplateRevisionByHash;
    insert: typeof insertTemplateRevision;
  };
  profiles: {
    upsert: typeof upsertProfile;
    setActive: typeof setProfileActiveRevision;
  };
  templates: {
    upsert: typeof upsertTemplate;
    setActive: typeof setTemplateActiveRevision;
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
    activate: activateProfileRevision,
    getLatestByHash: getLatestProfileRevisionByHash,
    insert: insertProfileRevision,
  };
  const templateRevisions = overrides?.templateRevisions ?? {
    activate: activateTemplateRevision,
    getLatestByHash: getLatestTemplateRevisionByHash,
    insert: insertTemplateRevision,
  };
  const profiles = overrides?.profiles ?? {
    upsert: upsertProfile,
    setActive: setProfileActiveRevision,
  };
  const templates = overrides?.templates ?? {
    upsert: upsertTemplate,
    setActive: setTemplateActiveRevision,
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
  await Promise.all([
    profiles
      .upsert({
        id: selection.profileId,
        label: formatPromptLabel(selection.profileId),
        activeRevisionId: null,
      })
      .catch(() => null),
    templates
      .upsert({
        id: selection.templateId,
        label: formatPromptLabel(selection.templateId),
        activeRevisionId: null,
      })
      .catch(() => null),
  ]);

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
  await Promise.all([
    templates
      .upsert({
        id: selection.templateId,
        label: formatPromptLabel(selection.templateId),
        activeRevisionId: templateRevision.id,
      })
      .catch(() => null),
    templateRevisions.activate(selection.templateId, templateRevision.id).catch(() => null),
    templates.setActive(selection.templateId, templateRevision.id).catch(() => null),
  ]);
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
  await Promise.all([
    profiles
      .upsert({
        id: selection.profileId,
        label: formatPromptLabel(selection.profileId),
        activeRevisionId: profileRevision.id,
      })
      .catch(() => null),
    profileRevisions.activate(selection.profileId, profileRevision.id).catch(() => null),
    profiles.setActive(selection.profileId, profileRevision.id).catch(() => null),
  ]);

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
    resolvedProfileVersionLabel: profileRevision.versionLabel,
    resolvedProfileStatus: profileRevision.status,
    resolvedTemplateId: selection.templateId,
    resolvedTemplateHash: templateHash,
    resolvedTemplateRevisionId: templateRevision.id,
    resolvedTemplateUpdatedAt: templateRevision.createdAt,
    resolvedTemplateVersionLabel: templateRevision.versionLabel,
    resolvedTemplateStatus: templateRevision.status,
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
            resolvedProfileVersionLabel: promptPackage.resolvedProfileVersionLabel ?? null,
            resolvedProfileStatus: promptPackage.resolvedProfileStatus ?? null,
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
            resolvedTemplateVersionLabel: promptPackage.resolvedTemplateVersionLabel ?? null,
            resolvedTemplateStatus: promptPackage.resolvedTemplateStatus ?? null,
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

function formatPromptLabel(id: string): string {
  const filename = id.split('/').at(-1) ?? id;
  const name = filename.replace(/\.[^.]+$/, '');
  const normalized = name.replaceAll(/[_-]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : id;
}
