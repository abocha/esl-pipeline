import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import { insertPromptPackage } from '../domain/prompt-package-repository.js';
import {
  activateProfileRevision,
  getActiveProfileRevision,
  getLatestProfileRevisionByHash,
  insertProfileRevision,
} from '../domain/profile-revision-repository.js';
import type { ProfileRevisionRecord } from '../domain/profile-revision-model.js';
import { setProfileActiveRevision, upsertProfile } from '../domain/profile-repository.js';
import {
  activateTemplateRevision,
  getActiveTemplateRevision,
  getLatestTemplateRevisionByHash,
  insertTemplateRevision,
} from '../domain/template-revision-repository.js';
import type { TemplateRevisionRecord } from '../domain/template-revision-model.js';
import { setTemplateActiveRevision, upsertTemplate } from '../domain/template-repository.js';
import { getRecordingById } from '../domain/recording-repository.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  createTranscriptionStorage,
  createTranscriptionStorageForUri,
} from '../infrastructure/transcription-storage.js';
import { stitchPromptPayload } from './prompt-assembly.js';
import { PromptOptionError, resolvePromptSelection } from './prompt-options.js';
import { resolveStudentProfileBindingAt } from './student-profile-bindings.js';
import { getStudentProfileById } from './student-profiles-store.js';

export interface CreatePromptPackageParams {
  recordingId: string;
  notes?: string | null;
  profilePath?: string | null;
  profileId?: string | null;
  templateId?: string | null;
  bindingEffectiveAt?: Date;
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
  bindings: {
    resolveAt: typeof resolveStudentProfileBindingAt;
  };
  promptPackages: {
    insert: typeof insertPromptPackage;
  };
  profileRevisions: {
    activate: typeof activateProfileRevision;
    getActive: typeof getActiveProfileRevision;
    getLatestByHash: typeof getLatestProfileRevisionByHash;
    insert: typeof insertProfileRevision;
  };
  templateRevisions: {
    activate: typeof activateTemplateRevision;
    getActive: typeof getActiveTemplateRevision;
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
  promptWriteAllowFsFallback: boolean;
}

interface PromptArtifactResolution {
  profile: {
    content: string;
    hash: string;
    revision: ProfileRevisionRecord;
  };
  template: {
    content: string;
    hash: string;
    revision: TemplateRevisionRecord;
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
  const bindings = overrides?.bindings ?? {
    resolveAt: resolveStudentProfileBindingAt,
  };
  const promptPackages = overrides?.promptPackages ?? {
    insert: insertPromptPackage,
  };
  const profileRevisions = overrides?.profileRevisions ?? {
    activate: activateProfileRevision,
    getActive: getActiveProfileRevision,
    getLatestByHash: getLatestProfileRevisionByHash,
    insert: insertProfileRevision,
  };
  const templateRevisions = overrides?.templateRevisions ?? {
    activate: activateTemplateRevision,
    getActive: getActiveTemplateRevision,
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
  const promptWriteAllowFsFallback =
    overrides?.promptWriteAllowFsFallback ??
    process.env.PROMPT_WRITE_ALLOW_FS_FALLBACK !== 'false';

  const transcript = await transcripts.getByRecordingId(params.recordingId);
  if (!transcript) return null;
  const recording = await recordings.getById(transcript.recordingId);
  const bindingLookupAt =
    params.bindingEffectiveAt && !Number.isNaN(params.bindingEffectiveAt.getTime())
      ? params.bindingEffectiveAt
      : recording?.createdAt ?? new Date();

  let studentProfileId: string | null = null;
  if (recording?.studentId) {
    const studentProfile = await students.getById(recording.studentId, { config });
    studentProfileId = studentProfile?.profileId ?? null;
    if (!studentProfileId) {
      const binding = await bindings.resolveAt(recording.studentId, bindingLookupAt).catch(() => null);
      studentProfileId = binding?.profileId ?? null;
    }
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

  const readStorage = overrides?.storage ?? createTranscriptionStorageForUri(transcript.storageUri);
  const [artifacts, transcriptText] = await Promise.all([
    resolvePromptArtifactsForWrite({
      selection,
      allowFsFallback: promptWriteAllowFsFallback,
      profileRevisions,
      templateRevisions,
      profiles,
      templates,
    }),
    readStorage.getText(transcript.storageUri),
  ]);

  const payload = stitchPromptPayload({
    template: artifacts.template.content,
    profile: artifacts.profile.content,
    transcript: transcriptText,
    notes: params.notes,
  });

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
    profilePath: selection.profilePath,
    resolvedProfileId: selection.profileId,
    resolvedProfileHash: artifacts.profile.hash,
    resolvedProfileRevisionId: artifacts.profile.revision.id,
    resolvedProfileUpdatedAt: artifacts.profile.revision.createdAt,
    resolvedProfileVersionLabel: artifacts.profile.revision.versionLabel,
    resolvedProfileStatus: artifacts.profile.revision.status,
    resolvedTemplateId: selection.templateId,
    resolvedTemplateHash: artifacts.template.hash,
    resolvedTemplateRevisionId: artifacts.template.revision.id,
    resolvedTemplateUpdatedAt: artifacts.template.revision.createdAt,
    resolvedTemplateVersionLabel: artifacts.template.revision.versionLabel,
    resolvedTemplateStatus: artifacts.template.revision.status,
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

async function resolvePromptArtifactsForWrite(params: {
  selection: {
    templateId: string;
    templatePath: string;
    profileId: string;
    profilePath: string;
  };
  allowFsFallback: boolean;
  profileRevisions: CreatePromptPackageDependencies['profileRevisions'];
  templateRevisions: CreatePromptPackageDependencies['templateRevisions'];
  profiles: CreatePromptPackageDependencies['profiles'];
  templates: CreatePromptPackageDependencies['templates'];
}): Promise<PromptArtifactResolution> {
  const { selection, allowFsFallback, profileRevisions, templateRevisions, profiles, templates } = params;

  const [activeProfileRevision, activeTemplateRevision] = await Promise.all([
    profileRevisions.getActive(selection.profileId).catch(() => null),
    templateRevisions.getActive(selection.templateId).catch(() => null),
  ]);

  const profileResolution = await resolveProfileArtifact({
    selection,
    activeProfileRevision,
    allowFsFallback,
    profileRevisions,
    profiles,
  });
  const templateResolution = await resolveTemplateArtifact({
    selection,
    activeTemplateRevision,
    allowFsFallback,
    templateRevisions,
    templates,
  });

  return {
    profile: profileResolution,
    template: templateResolution,
  };
}

async function resolveProfileArtifact(params: {
  selection: { profileId: string; profilePath: string };
  activeProfileRevision: ProfileRevisionRecord | null;
  allowFsFallback: boolean;
  profileRevisions: CreatePromptPackageDependencies['profileRevisions'];
  profiles: CreatePromptPackageDependencies['profiles'];
}): Promise<PromptArtifactResolution['profile']> {
  const { selection, activeProfileRevision, allowFsFallback, profileRevisions, profiles } = params;

  if (activeProfileRevision) {
    return {
      content: activeProfileRevision.content,
      hash: activeProfileRevision.contentHash,
      revision: activeProfileRevision,
    };
  }

  if (!allowFsFallback) {
    throw new PromptOptionError(
      `No active profile revision for "${selection.profileId}" and filesystem fallback is disabled.`,
      'profile_revision_missing',
    );
  }

  const content = await fs.readFile(selection.profilePath, 'utf8');
  const hash = hashProfileContent(content);
  const existing = await profileRevisions.getLatestByHash(selection.profileId, hash);
  const revision =
    existing ??
    (await profileRevisions.insert({
      profileId: selection.profileId,
      content,
      contentHash: hash,
      source: 'update',
      createdBy: null,
      restoredFromRevisionId: null,
    }));

  await Promise.all([
    profiles
      .upsert({
        id: selection.profileId,
        label: formatPromptLabel(selection.profileId),
        activeRevisionId: revision.id,
      })
      .catch(() => null),
    profileRevisions.activate(selection.profileId, revision.id).catch(() => null),
    profiles.setActive(selection.profileId, revision.id).catch(() => null),
  ]);

  return {
    content,
    hash,
    revision,
  };
}

async function resolveTemplateArtifact(params: {
  selection: { templateId: string; templatePath: string };
  activeTemplateRevision: TemplateRevisionRecord | null;
  allowFsFallback: boolean;
  templateRevisions: CreatePromptPackageDependencies['templateRevisions'];
  templates: CreatePromptPackageDependencies['templates'];
}): Promise<PromptArtifactResolution['template']> {
  const { selection, activeTemplateRevision, allowFsFallback, templateRevisions, templates } = params;

  if (activeTemplateRevision) {
    return {
      content: activeTemplateRevision.content,
      hash: activeTemplateRevision.contentHash,
      revision: activeTemplateRevision,
    };
  }

  if (!allowFsFallback) {
    throw new PromptOptionError(
      `No active template revision for "${selection.templateId}" and filesystem fallback is disabled.`,
      'template_revision_missing',
    );
  }

  const content = await fs.readFile(selection.templatePath, 'utf8');
  const hash = hashContent(content);
  const existing = await templateRevisions.getLatestByHash(selection.templateId, hash);
  const revision =
    existing ??
    (await templateRevisions.insert({
      templateId: selection.templateId,
      content,
      contentHash: hash,
      source: 'update',
      createdBy: null,
      restoredFromRevisionId: null,
    }));

  await Promise.all([
    templates
      .upsert({
        id: selection.templateId,
        label: formatPromptLabel(selection.templateId),
        activeRevisionId: revision.id,
      })
      .catch(() => null),
    templateRevisions.activate(selection.templateId, revision.id).catch(() => null),
    templates.setActive(selection.templateId, revision.id).catch(() => null),
  ]);

  return {
    content,
    hash,
    revision,
  };
}
