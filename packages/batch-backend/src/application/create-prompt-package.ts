import { createHash, randomUUID } from 'node:crypto';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { ProfileRevisionRecord } from '../domain/profile-revision-model.js';
import {
  activateProfileRevision,
  getActiveProfileRevision,
} from '../domain/profile-revision-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import { insertPromptPackage } from '../domain/prompt-package-repository.js';
import { getRecordingById } from '../domain/recording-repository.js';
import type { TemplateRevisionRecord } from '../domain/template-revision-model.js';
import {
  activateTemplateRevision,
  getActiveTemplateRevision,
} from '../domain/template-revision-repository.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  createTranscriptionStorage,
  createTranscriptionStorageForUri,
} from '../infrastructure/transcription-storage.js';
import {
  deriveFoundationalProfileFromMarkdown,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
import { stitchPromptEnvelope, stitchPromptPayload } from './prompt-assembly.js';
import { PromptOptionError, resolvePromptSelection } from './prompt-options.js';
import { requestLessonMemoryGeneration } from './request-lesson-memory-generation.js';
import { buildStudentMemoryPackageContext } from './student-memory-package.js';
import { resolveStudentProfileBindingAt } from './student-profile-bindings.js';
import { getStudentProfileById } from './student-profiles-store.js';

const LEGACY_PROFILE_MARKER = 'INSERT PROFILE HERE';

export interface CreatePromptPackageParams {
  recordingId: string;
  notes?: string | null;
  profilePath?: string | null;
  profileId?: string | null;
  templateId?: string | null;
  lessonId?: string | null;
  bindingEffectiveAt?: Date;
}

export interface PromptPackageResponse {
  id: string;
  recordingId: string;
  transcriptId: string;
  studentId: string | null;
  lessonId: string | null;
  profilePath: string | null;
  templateVersion: string;
  notes: string | null;
  storageUri: string;
  text: string;
  requestEnvelope?: unknown | null;
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
  memory: {
    studentMemorySnapshotId: string | null;
    studentMemorySnapshotHash: string | null;
    selectedLessonMemoryIds: string[];
    selectedHomeworkMemoryIds: string[];
    retrievalPolicyVersion: string | null;
    layerAvailability: PromptPackageMemoryLayerAvailability;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PromptPackageMemoryLayerAvailability {
  studentMemorySnapshot: 'available' | 'missing' | 'not_applicable';
  recentLessonMemory: 'available' | 'missing' | 'not_applicable';
  recentHomeworkMemory: 'available' | 'missing' | 'not_applicable';
  retrievalPolicy: 'available' | 'missing' | 'not_applicable';
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
  promptOptions: {
    resolveSelection: typeof resolvePromptSelection;
  };
  promptPackages: {
    insert: typeof insertPromptPackage;
  };
  profileRevisions: {
    activate: typeof activateProfileRevision;
    getActive: typeof getActiveProfileRevision;
  };
  templateRevisions: {
    activate: typeof activateTemplateRevision;
    getActive: typeof getActiveTemplateRevision;
  };
  lessonMemory: {
    requestGeneration: typeof requestLessonMemoryGeneration;
  };
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
  const promptOptions = overrides?.promptOptions ?? {
    resolveSelection: resolvePromptSelection,
  };
  const promptPackages = overrides?.promptPackages ?? {
    insert: insertPromptPackage,
  };
  const profileRevisions = overrides?.profileRevisions ?? {
    activate: activateProfileRevision,
    getActive: getActiveProfileRevision,
  };
  const templateRevisions = overrides?.templateRevisions ?? {
    activate: activateTemplateRevision,
    getActive: getActiveTemplateRevision,
  };
  const lessonMemory = overrides?.lessonMemory ?? {
    requestGeneration: requestLessonMemoryGeneration,
  };

  const transcript = await transcripts.getByRecordingId(params.recordingId);
  if (!transcript) return null;
  const recording = await recordings.getById(transcript.recordingId);
  if (params.lessonId && recording?.studentId) {
    await validateLessonStudentPair(params.lessonId, recording.studentId);
  }
  const bindingLookupAt =
    params.bindingEffectiveAt && !Number.isNaN(params.bindingEffectiveAt.getTime())
      ? params.bindingEffectiveAt
      : (recording?.createdAt ?? new Date());

  let studentProfileId: string | null = null;
  if (recording?.studentId) {
    const studentProfile = await students.getById(recording.studentId, { config });
    studentProfileId = studentProfile?.profileId ?? null;
    if (!studentProfileId) {
      const binding = await bindings
        .resolveAt(recording.studentId, bindingLookupAt)
        .catch(() => null);
      studentProfileId = binding?.profileId ?? null;
    }
  }

  const fallbackProfileId =
    params.profileId ?? (params.profilePath ? undefined : (studentProfileId ?? undefined));

  const selection = await promptOptions.resolveSelection(
    {
      templateId: params.templateId,
      profileId: fallbackProfileId,
      profilePath: params.profilePath,
    },
    { config },
  );

  const readStorage = overrides?.storage ?? createTranscriptionStorageForUri(transcript.storageUri);
  const [artifacts, transcriptText] = await Promise.all([
    resolvePromptArtifactsForWrite({
      selection,
      profileRevisions,
      templateRevisions,
    }),
    readStorage.getText(transcript.storageUri),
  ]);
  const memoryContext = await buildStudentMemoryPackageContext({
    studentId: recording?.studentId ?? null,
    currentTranscriptId: transcript.id,
    config,
  });
  const payload = stitchPromptPayload({
    template: artifacts.template.content,
    profile: artifacts.profile.content,
    studentMemorySnapshot: memoryContext.studentMemorySnapshotBlock,
    recentLessonMemory: memoryContext.recentLessonMemoryBlock,
    recentHomeworkMemory: memoryContext.recentHomeworkMemoryBlock,
    unresolvedIssues: memoryContext.unresolvedIssuesBlock,
    transcript: transcriptText,
    notes: params.notes,
  });
  const requestEnvelope = stitchPromptEnvelope({
    template: artifacts.template.content,
    profile: artifacts.profile.content,
    studentMemorySnapshot: memoryContext.studentMemorySnapshotBlock,
    recentLessonMemory: memoryContext.recentLessonMemoryBlock,
    recentHomeworkMemory: memoryContext.recentHomeworkMemoryBlock,
    unresolvedIssues: memoryContext.unresolvedIssuesBlock,
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
    lessonId: params.lessonId ?? null,
    studentMemorySnapshotId: memoryContext.studentMemorySnapshotId,
    studentMemorySnapshotHash: memoryContext.studentMemorySnapshotHash,
    selectedLessonMemoryIds: memoryContext.selectedLessonMemoryIds,
    selectedHomeworkMemoryIds: memoryContext.selectedHomeworkMemoryIds,
    retrievalPolicyVersion: memoryContext.retrievalPolicyVersion,
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
    requestEnvelope,
  });

  const response = toPromptPackageResponse(promptPackage, payload);

  if (recording?.studentId && (config as { generation?: unknown }).generation) {
    void lessonMemory
      .requestGeneration({
        config,
        params: {
          studentId: recording.studentId,
          transcriptId: transcript.id,
          recordingId: transcript.recordingId,
          promptPackageId: promptPackage.id,
          trigger: 'prompt-package-created',
        },
      })
      .catch((error) => {
        logger.warn('Lesson-memory enqueue failed after prompt-package creation; continuing', {
          event: 'lesson_memory_enqueue_failed_non_blocking',
          promptPackageId: promptPackage.id,
          transcriptId: transcript.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  return response;
}

async function validateLessonStudentPair(lessonId: string, studentId: string): Promise<void> {
  const belongsToStudent = await withPgClient(async (client) => {
    const result = await client.query(
      'SELECT 1 FROM student_lessons WHERE id = $1 AND student_id = $2',
      [lessonId, studentId],
    );
    return (result.rowCount ?? 0) > 0;
  });
  if (!belongsToStudent) {
    throw new Error('Prompt-package lesson must belong to the recording student');
  }
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
    lessonId: promptPackage.lessonId ?? null,
    profilePath: promptPackage.profilePath ?? null,
    templateVersion: promptPackage.templateVersion,
    notes: promptPackage.notes ?? null,
    storageUri: promptPackage.storageUri,
    text,
    ...(promptPackage.requestEnvelope !== null && promptPackage.requestEnvelope !== undefined
      ? { requestEnvelope: promptPackage.requestEnvelope }
      : {}),
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
    memory: {
      studentMemorySnapshotId: promptPackage.studentMemorySnapshotId ?? null,
      studentMemorySnapshotHash: promptPackage.studentMemorySnapshotHash ?? null,
      selectedLessonMemoryIds: promptPackage.selectedLessonMemoryIds ?? [],
      selectedHomeworkMemoryIds: promptPackage.selectedHomeworkMemoryIds ?? [],
      retrievalPolicyVersion: promptPackage.retrievalPolicyVersion ?? null,
      layerAvailability: getPromptPackageMemoryLayerAvailability(promptPackage),
    },
    createdAt: promptPackage.createdAt.toISOString(),
    updatedAt: promptPackage.updatedAt.toISOString(),
  };
}

export function getPromptPackageMemoryLayerAvailability(
  promptPackage: Pick<
    PromptPackageRecord,
    | 'studentId'
    | 'studentMemorySnapshotId'
    | 'selectedLessonMemoryIds'
    | 'selectedHomeworkMemoryIds'
    | 'retrievalPolicyVersion'
  >,
): PromptPackageMemoryLayerAvailability {
  if (!promptPackage.studentId) {
    return {
      studentMemorySnapshot: 'not_applicable',
      recentLessonMemory: 'not_applicable',
      recentHomeworkMemory: 'not_applicable',
      retrievalPolicy: 'not_applicable',
    };
  }

  return {
    studentMemorySnapshot: promptPackage.studentMemorySnapshotId ? 'available' : 'missing',
    recentLessonMemory:
      (promptPackage.selectedLessonMemoryIds?.length ?? 0) > 0 ? 'available' : 'missing',
    recentHomeworkMemory:
      (promptPackage.selectedHomeworkMemoryIds?.length ?? 0) > 0 ? 'available' : 'missing',
    retrievalPolicy: promptPackage.retrievalPolicyVersion ? 'available' : 'missing',
  };
}

async function resolvePromptArtifactsForWrite(params: {
  selection: {
    templateId: string;
    profileId: string;
    profilePath: string;
  };
  profileRevisions: CreatePromptPackageDependencies['profileRevisions'];
  templateRevisions: CreatePromptPackageDependencies['templateRevisions'];
}): Promise<PromptArtifactResolution> {
  const { selection, profileRevisions, templateRevisions } = params;

  const [activeProfileRevision, activeTemplateRevision] = await Promise.all([
    profileRevisions.getActive(selection.profileId).catch(() => null),
    templateRevisions.getActive(selection.templateId).catch(() => null),
  ]);

  const profileResolution = await resolveProfileArtifact({
    selection,
    activeProfileRevision,
  });
  const templateResolution = await resolveTemplateArtifact({
    selection,
    activeTemplateRevision,
  });

  return {
    profile: profileResolution,
    template: templateResolution,
  };
}

async function resolveProfileArtifact(params: {
  selection: { profileId: string; profilePath: string };
  activeProfileRevision: ProfileRevisionRecord | null;
}): Promise<PromptArtifactResolution['profile']> {
  const { selection, activeProfileRevision } = params;

  if (activeProfileRevision) {
    const renderedContent = renderPromptProfileContent(activeProfileRevision);
    return {
      content: renderedContent,
      hash: hashPromptProfileContent(activeProfileRevision),
      revision: activeProfileRevision,
    };
  }

  throw new PromptOptionError(
    `No active profile revision for "${selection.profileId}". Run prompt-assets bootstrap before generation.`,
    'profile_revision_missing',
  );
}

export function renderPromptProfileContent(revision: ProfileRevisionRecord): string {
  const structuredContent =
    revision.structuredContent ?? deriveFoundationalProfileFromMarkdown(revision.content);
  return structuredContent ? renderFoundationalProfileContent(structuredContent) : revision.content;
}

export function hashPromptProfileContent(revision: ProfileRevisionRecord): string {
  return createHash('sha256').update(renderPromptProfileContent(revision), 'utf8').digest('hex');
}

async function resolveTemplateArtifact(params: {
  selection: { templateId: string };
  activeTemplateRevision: TemplateRevisionRecord | null;
}): Promise<PromptArtifactResolution['template']> {
  const { selection, activeTemplateRevision } = params;

  if (activeTemplateRevision) {
    if (activeTemplateRevision.content.includes(LEGACY_PROFILE_MARKER)) {
      throw new PromptOptionError(
        `Active template "${selection.templateId}" still uses retired legacy marker ${LEGACY_PROFILE_MARKER}. Migrate or replace the template revision before generation.`,
        'template_revision_legacy_marker',
      );
    }
    return {
      content: activeTemplateRevision.content,
      hash: activeTemplateRevision.contentHash,
      revision: activeTemplateRevision,
    };
  }

  throw new PromptOptionError(
    `No active template revision for "${selection.templateId}". Run prompt-assets bootstrap before generation.`,
    'template_revision_missing',
  );
}
