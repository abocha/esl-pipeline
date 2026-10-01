import { createHash, randomUUID } from 'node:crypto';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { AssignmentSessionRecord } from '../domain/assignment-session-model.js';
import {
  getAssignmentSessionByIdForUser,
  isAssignmentConfirmedSourceCanonical,
} from '../domain/assignment-session-repository.js';
import type { ProfileRevisionRecord } from '../domain/profile-revision-model.js';
import {
  activateProfileRevision,
  getActiveProfileRevision,
  getProfileRevisionById,
  getRecordedProfileRevision,
} from '../domain/profile-revision-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import { insertPromptPackage } from '../domain/prompt-package-repository.js';
import { getRecordingByIdForWorkspace } from '../domain/recording-repository.js';
import type { TemplateRevisionRecord } from '../domain/template-revision-model.js';
import {
  activateTemplateRevision,
  getActiveTemplateRevision,
} from '../domain/template-revision-repository.js';
import { getTranscriptByRecordingIdForWorkspace } from '../domain/transcript-repository.js';
import { withPgClient } from '../infrastructure/db.js';
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
import { PromptOptionError, resolvePromptTemplateSelection } from './prompt-options.js';
import { buildStudentMemoryPackageContext } from './student-memory-package.js';
import { getStudentProfileById } from './student-profiles-store.js';

const LEGACY_PROFILE_MARKER = 'INSERT PROFILE HERE';

export interface CreatePromptPackageParams {
  recordingId: string;
  workspaceId: string;
  assignmentSessionId?: string;
  userId?: string;
  notes?: string | null;
  templateId?: string | null;
  lessonId?: string | null;
}

export interface PromptPackageResponse {
  id: string;
  recordingId: string;
  transcriptId: string;
  studentId: string | null;
  lessonId: string | null;
  /** Historical input path, retained in stored package provenance only. */
  profilePath: string | null;
  templateVersion: string;
  notes: string | null;
  storageUri: string;
  text: string;
  requestEnvelope?: unknown | null;
  profileSnapshot?: {
    resolvedProfileId: string | null;
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
    getByRecordingId: typeof getTranscriptByRecordingIdForWorkspace;
  };
  recordings: {
    getById: typeof getRecordingByIdForWorkspace;
  };
  students: {
    getById: typeof getStudentProfileById;
  };
  promptOptions: {
    resolveTemplateSelection?: typeof resolvePromptTemplateSelection;
  };
  promptPackages: {
    insert: typeof insertPromptPackage;
  };
  profileRevisions: {
    activate: typeof activateProfileRevision;
    getActive: typeof getActiveProfileRevision;
    getById: typeof getProfileRevisionById;
    getRecorded?: typeof getRecordedProfileRevision;
  };
  sessions: {
    getByIdForUser: typeof getAssignmentSessionByIdForUser;
    isConfirmedSourceCanonical: typeof isAssignmentConfirmedSourceCanonical;
  };
  templateRevisions: {
    activate: typeof activateTemplateRevision;
    getActive: typeof getActiveTemplateRevision;
  };
}

export class PromptPackageAssignmentError extends Error {
  constructor(
    readonly code:
      | 'PROMPT_PACKAGE_ASSIGNMENT_SESSION_NOT_FOUND'
      | 'PROMPT_PACKAGE_CONFIRMED_PREREQUISITE_MISSING'
      | 'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID'
      | 'PROMPT_PACKAGE_CONFIRMED_SOURCE_HASH_MISMATCH'
      | 'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
    message: string,
  ) {
    super(message);
    this.name = 'PromptPackageAssignmentError';
  }
}

interface PromptArtifactResolution {
  profile: {
    content: string;
    hash: string;
    revision: ProfileRevisionRecord;
  } | null;
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
    getByRecordingId: getTranscriptByRecordingIdForWorkspace,
  };
  const recordings = overrides?.recordings ?? {
    getById: getRecordingByIdForWorkspace,
  };
  const students = overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const promptOptions = overrides?.promptOptions ?? {
    resolveTemplateSelection: resolvePromptTemplateSelection,
  };
  const promptPackages = overrides?.promptPackages ?? {
    insert: insertPromptPackage,
  };
  const profileRevisions = overrides?.profileRevisions ?? {
    activate: activateProfileRevision,
    getActive: getActiveProfileRevision,
    getById: getProfileRevisionById,
  };
  const sessions = overrides?.sessions ?? {
    getByIdForUser: getAssignmentSessionByIdForUser,
    isConfirmedSourceCanonical: isAssignmentConfirmedSourceCanonical,
  };
  const templateRevisions = overrides?.templateRevisions ?? {
    activate: activateTemplateRevision,
    getActive: getActiveTemplateRevision,
  };

  if (Boolean(params.assignmentSessionId) !== Boolean(params.userId)) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_CONFIRMED_PREREQUISITE_MISSING',
      'Assignment prompt generation requires both assignmentSessionId and authenticated userId',
    );
  }
  const assignmentSession =
    params.assignmentSessionId && params.userId
      ? await sessions.getByIdForUser(params.assignmentSessionId, params.userId)
      : null;
  if (params.assignmentSessionId && !assignmentSession) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_ASSIGNMENT_SESSION_NOT_FOUND',
      'Assignment session was not found',
    );
  }
  if (assignmentSession && (params.notes !== undefined || params.lessonId !== undefined)) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID',
      'Assignment prompt inputs must come from confirmed session state',
    );
  }

  const confirmedInputs = assignmentSession
    ? await resolveConfirmedAssignmentInputs({
        session: assignmentSession,
        routeRecordingId: params.recordingId,
        workspaceId: params.workspaceId,
        recordings,
        profileRevisions,
      })
    : null;
  if (
    assignmentSession &&
    confirmedInputs &&
    !(await sessions.isConfirmedSourceCanonical(assignmentSession.id, assignmentSession.userId, {
      recordingId: confirmedInputs.source.recordingId,
      transcriptId: confirmedInputs.source.transcriptId,
    }))
  ) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
      'Assignment source is no longer canonical',
    );
  }
  const transcript = confirmedInputs
    ? {
        id: confirmedInputs.source.transcriptId,
        recordingId: confirmedInputs.source.recordingId,
        storageUri: confirmedInputs.source.transcriptStorageUri,
      }
    : await transcripts.getByRecordingId(params.recordingId, params.workspaceId);
  if (!transcript) return null;
  const recording =
    confirmedInputs?.recording ??
    (await recordings.getById(transcript.recordingId, params.workspaceId));
  const lessonId = confirmedInputs?.source.lessonId ?? params.lessonId ?? null;
  const notes = confirmedInputs?.context.teacherNotes ?? params.notes ?? null;
  if (!confirmedInputs && lessonId && recording?.studentId) {
    await validateLessonStudentPair(lessonId, recording.studentId);
  }
  const student = recording?.studentId
    ? await students.getById(recording.studentId, { config, workspaceId: params.workspaceId })
    : null;
  if (recording?.studentId && !student) return null;
  const canonicalStudentName = student?.student ?? null;
  const activeProfile =
    !confirmedInputs && student ? await profileRevisions.getActive(student.id) : null;
  const omitProfile = confirmedInputs ? !confirmedInputs.context.profileRevisionId : !activeProfile;
  const selection = {
    ...(await (promptOptions.resolveTemplateSelection ?? resolvePromptTemplateSelection)(
      { templateId: params.templateId },
      { config },
    )),
    studentId: student?.id ?? '',
  };
  const readStorage = overrides?.storage ?? createTranscriptionStorageForUri(transcript.storageUri);
  const [artifacts, transcriptText] = await Promise.all([
    resolvePromptArtifactsForWrite({
      selection,
      profileRevisions,
      templateRevisions,
      confirmedProfileRevision: confirmedInputs?.profileRevision ?? null,
      omitProfile,
    }),
    readStorage.getText(transcript.storageUri),
  ]);
  if (confirmedInputs) {
    const actualTranscriptHash = createHash('sha256').update(transcriptText, 'utf8').digest('hex');
    if (actualTranscriptHash !== confirmedInputs.source.transcriptHash) {
      throw new PromptPackageAssignmentError(
        'PROMPT_PACKAGE_CONFIRMED_SOURCE_HASH_MISMATCH',
        'Confirmed transcript content no longer matches its server hash',
      );
    }
  }
  const memoryContext = await buildStudentMemoryPackageContext({
    studentId: recording?.studentId ?? null,
    currentTranscriptId: transcript.id,
    config,
  });
  const payload = stitchPromptPayload({
    template: artifacts.template.content,
    profile: artifacts.profile?.content ?? '',
    studentMemorySnapshot: memoryContext.studentMemorySnapshotBlock,
    recentLessonMemory: memoryContext.recentLessonMemoryBlock,
    recentHomeworkMemory: memoryContext.recentHomeworkMemoryBlock,
    unresolvedIssues: memoryContext.unresolvedIssuesBlock,
    transcript: transcriptText,
    canonicalStudentName,
    notes,
  });
  const requestEnvelope = stitchPromptEnvelope({
    template: artifacts.template.content,
    profile: artifacts.profile?.content ?? '',
    studentMemorySnapshot: memoryContext.studentMemorySnapshotBlock,
    recentLessonMemory: memoryContext.recentLessonMemoryBlock,
    recentHomeworkMemory: memoryContext.recentHomeworkMemoryBlock,
    unresolvedIssues: memoryContext.unresolvedIssuesBlock,
    transcript: transcriptText,
    canonicalStudentName,
    notes,
  });

  const promptPackageId = randomUUID();
  const stored = await storage.putPromptPackage({
    promptPackageId,
    text: payload,
  });

  if (
    assignmentSession &&
    confirmedInputs &&
    !(await sessions.isConfirmedSourceCanonical(assignmentSession.id, assignmentSession.userId, {
      recordingId: confirmedInputs.source.recordingId,
      transcriptId: confirmedInputs.source.transcriptId,
    }))
  ) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
      'Assignment source is no longer canonical',
    );
  }

  const promptPackage = await promptPackages.insert({
    id: promptPackageId,
    recordingId: transcript.recordingId,
    transcriptId: transcript.id,
    assignmentSessionId: assignmentSession?.id ?? null,
    studentId: recording?.studentId ?? null,
    lessonId,
    studentMemorySnapshotId: memoryContext.studentMemorySnapshotId,
    studentMemorySnapshotHash: memoryContext.studentMemorySnapshotHash,
    selectedLessonMemoryIds: memoryContext.selectedLessonMemoryIds,
    selectedHomeworkMemoryIds: memoryContext.selectedHomeworkMemoryIds,
    retrievalPolicyVersion: memoryContext.retrievalPolicyVersion,
    profilePath: null,
    resolvedProfileId: confirmedInputs?.context.profileId ?? null,
    resolvedProfileHash: artifacts.profile?.hash ?? null,
    resolvedProfileRevisionId:
      confirmedInputs?.context.profileRevisionId ?? artifacts.profile?.revision.id ?? null,
    resolvedProfileUpdatedAt: artifacts.profile?.revision.createdAt ?? null,
    resolvedProfileVersionLabel: confirmedInputs?.context.profileId
      ? (artifacts.profile?.revision.legacyVersionLabel ??
        artifacts.profile?.revision.versionLabel ??
        null)
      : (artifacts.profile?.revision.versionLabel ?? null),
    resolvedProfileStatus: artifacts.profile?.revision.status ?? null,
    resolvedTemplateId: selection.templateId,
    resolvedTemplateHash: artifacts.template.hash,
    resolvedTemplateRevisionId: artifacts.template.revision.id,
    resolvedTemplateUpdatedAt: artifacts.template.revision.createdAt,
    resolvedTemplateVersionLabel: artifacts.template.revision.versionLabel,
    resolvedTemplateStatus: artifacts.template.revision.status,
    templateVersion: selection.templateId,
    notes,
    storageUri: stored.uri,
    requestEnvelope,
  });

  const response = toPromptPackageResponse(promptPackage, payload);

  return response;
}

async function resolveConfirmedAssignmentInputs(params: {
  session: AssignmentSessionRecord;
  routeRecordingId: string;
  workspaceId: string;
  recordings: CreatePromptPackageDependencies['recordings'];
  profileRevisions: CreatePromptPackageDependencies['profileRevisions'];
}) {
  const { session } = params;
  const source = session.confirmed.source;
  const context = session.confirmed.context;
  if (!source || !context) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_CONFIRMED_PREREQUISITE_MISSING',
      'Confirmed Source and Context are required before prompt generation',
    );
  }
  if (
    session.confirmed.student.studentId !== session.studentId ||
    source.recordingId !== params.routeRecordingId ||
    session.recordingId !== source.recordingId ||
    session.transcriptId !== source.transcriptId
  ) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID',
      'Confirmed Source does not match the assignment session lineage',
    );
  }
  const recording = await params.recordings.getById(source.recordingId, params.workspaceId);
  if (!recording || recording.studentId !== session.studentId) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID',
      'Confirmed recording does not belong to the assignment student',
    );
  }

  const profileValues = [context.profileRevisionId, context.profileRevisionHash];
  if (
    profileValues.some((value) => value !== null) &&
    profileValues.some((value) => value === null)
  ) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID',
      'Confirmed Context has incomplete profile provenance',
    );
  }
  let profileRevision: ProfileRevisionRecord | null = null;
  if (context.profileRevisionId && context.profileRevisionHash) {
    profileRevision = await (params.profileRevisions.getRecorded ?? getRecordedProfileRevision)(
      session.studentId,
      context.profileRevisionId,
      context.profileRevisionHash,
    );
    if (
      !profileRevision ||
      profileRevision.studentId !== session.studentId ||
      profileRevision.contentHash !== context.profileRevisionHash
    ) {
      throw new PromptPackageAssignmentError(
        'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID',
        'Confirmed profile revision no longer matches Context provenance',
      );
    }
  }
  return { source, context, recording, profileRevision };
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
    typeof promptPackage.resolvedProfileRevisionId === 'string' &&
    promptPackage.resolvedProfileRevisionId.length > 0 &&
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
    studentId: string;
  };
  profileRevisions: CreatePromptPackageDependencies['profileRevisions'];
  templateRevisions: CreatePromptPackageDependencies['templateRevisions'];
  confirmedProfileRevision: ProfileRevisionRecord | null;
  omitProfile: boolean;
}): Promise<PromptArtifactResolution> {
  const { selection, profileRevisions, templateRevisions, confirmedProfileRevision, omitProfile } =
    params;

  const [activeProfileRevision, activeTemplateRevision] = await Promise.all([
    omitProfile
      ? Promise.resolve(null)
      : confirmedProfileRevision
        ? Promise.resolve(confirmedProfileRevision)
        : profileRevisions.getActive(selection.studentId).catch(() => null),
    templateRevisions.getActive(selection.templateId).catch(() => null),
  ]);

  const profileResolution = omitProfile
    ? null
    : await resolveProfileArtifact({
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
  selection: { studentId: string };
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
    `No active profile revision for "${selection.studentId}". Create or activate a profile in Student Learning before generation.`,
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
    `No active template revision for "${selection.templateId}". Create or activate a profile in Student Learning before generation.`,
    'template_revision_missing',
  );
}
