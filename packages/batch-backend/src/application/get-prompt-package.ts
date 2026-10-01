import type { ProfileRevisionRecord } from '../domain/profile-revision-model.js';
import { getActiveProfileRevision } from '../domain/profile-revision-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import type { TemplateRevisionRecord } from '../domain/template-revision-model.js';
import { getActiveTemplateRevision } from '../domain/template-revision-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import {
  getPromptPackageMemoryLayerAvailability,
  hashPromptProfileContent,
  type PromptPackageMemoryLayerAvailability,
  type PromptPackageResponse,
  toPromptPackageResponse,
} from './create-prompt-package.js';

type PromptPackageProfileDriftReason = 'profile_missing' | 'profile_content_changed';
type PromptPackageTemplateDriftReason = 'template_missing' | 'template_content_changed';

interface PromptPackageProfileDrift {
  detected: true;
  reason: PromptPackageProfileDriftReason;
  currentProfileHash: string | null;
  currentProfileRevisionId: string | null;
  currentProfileUpdatedAt: string | null;
}

interface PromptPackageTemplateDrift {
  detected: true;
  reason: PromptPackageTemplateDriftReason;
  currentTemplateHash: string | null;
  currentTemplateRevisionId: string | null;
  currentTemplateUpdatedAt: string | null;
}

export interface GetPromptPackageDependencies {
  storage: TranscriptionStorage;
  promptPackages: {
    getById: typeof getPromptPackageById;
  };
  profileRevisions: {
    getActive: typeof getActiveProfileRevision;
  };
  templateRevisions: {
    getActive: typeof getActiveTemplateRevision;
  };
}

export interface PromptPackageLineageResponse {
  promptPackageId: string;
  recordingId: string;
  transcriptId: string;
  studentId: string | null;
  createdAt: string;
  updatedAt: string;
  profile: {
    snapshot: {
      profileId: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    current: {
      studentId: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    drift: PromptPackageProfileDrift | null;
  };
  template: {
    snapshot: {
      templateId: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    current: {
      templateId: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    drift: PromptPackageTemplateDrift | null;
  };
  memory: {
    studentMemorySnapshotId: string | null;
    studentMemorySnapshotHash: string | null;
    selectedLessonMemoryIds: string[];
    selectedHomeworkMemoryIds: string[];
    retrievalPolicyVersion: string | null;
    layerAvailability: PromptPackageMemoryLayerAvailability;
  };
  bindingAtCreation?: {
    bindingId: string;
    studentId: string;
    profileId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    reason: string | null;
    changedBy: string | null;
    createdAt: string;
  } | null;
}

export async function getPromptPackage(
  promptPackageId: string,
  overrides?: Partial<GetPromptPackageDependencies>,
): Promise<PromptPackageResponse | null> {
  if (!promptPackageId) return null;

  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackageById,
  };
  const profileRevisions = overrides?.profileRevisions ?? {
    getActive: getActiveProfileRevision,
  };
  const templateRevisions = overrides?.templateRevisions ?? {
    getActive: getActiveTemplateRevision,
  };

  const promptPackage = await promptPackages.getById(promptPackageId);
  if (!promptPackage) return null;

  const storage = overrides?.storage ?? createTranscriptionStorageForUri(promptPackage.storageUri);
  const text = await storage.getText(promptPackage.storageUri);
  const response = toPromptPackageResponse(promptPackage, text);
  const profileDrift = await detectPromptPackageProfileDrift(
    promptPackage,
    profileRevisions.getActive,
  );
  const templateDrift = await detectPromptPackageTemplateDrift(
    promptPackage,
    templateRevisions.getActive,
  );
  return {
    ...response,
    ...(profileDrift ? { profileDrift } : {}),
    ...(templateDrift ? { templateDrift } : {}),
  };
}

export async function getPromptPackageLineage(
  promptPackageId: string,
  overrides?: Partial<GetPromptPackageDependencies>,
): Promise<PromptPackageLineageResponse | null> {
  if (!promptPackageId) return null;

  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackageById,
  };
  const profileRevisions = overrides?.profileRevisions ?? {
    getActive: getActiveProfileRevision,
  };
  const templateRevisions = overrides?.templateRevisions ?? {
    getActive: getActiveTemplateRevision,
  };

  const promptPackage = await promptPackages.getById(promptPackageId);
  if (!promptPackage) return null;

  const [currentProfile, currentTemplate] = await Promise.all([
    promptPackage.studentId
      ? profileRevisions.getActive(promptPackage.studentId)
      : Promise.resolve(null),
    promptPackage.resolvedTemplateId
      ? templateRevisions.getActive(promptPackage.resolvedTemplateId)
      : Promise.resolve(null),
  ]);

  const profileDrift = await detectPromptPackageProfileDrift(
    promptPackage,
    profileRevisions.getActive,
  );
  const templateDrift = await detectPromptPackageTemplateDrift(
    promptPackage,
    templateRevisions.getActive,
  );

  return {
    promptPackageId: promptPackage.id,
    recordingId: promptPackage.recordingId,
    transcriptId: promptPackage.transcriptId,
    studentId: promptPackage.studentId ?? null,
    createdAt: promptPackage.createdAt.toISOString(),
    updatedAt: promptPackage.updatedAt.toISOString(),
    profile: {
      snapshot: {
        profileId: promptPackage.resolvedProfileId ?? null,
        revisionId: promptPackage.resolvedProfileRevisionId ?? null,
        hash: promptPackage.resolvedProfileHash ?? null,
        versionLabel: promptPackage.resolvedProfileVersionLabel ?? null,
        status: promptPackage.resolvedProfileStatus ?? null,
        updatedAt: promptPackage.resolvedProfileUpdatedAt
          ? promptPackage.resolvedProfileUpdatedAt.toISOString()
          : null,
      },
      current: {
        studentId: promptPackage.studentId ?? null,
        revisionId: currentProfile?.id ?? null,
        hash: currentProfile ? hashPromptProfileContent(currentProfile) : null,
        versionLabel: currentProfile?.versionLabel ?? null,
        status: currentProfile?.status ?? null,
        updatedAt: currentProfile?.createdAt ? currentProfile.createdAt.toISOString() : null,
      },
      drift: profileDrift,
    },
    template: {
      snapshot: {
        templateId: promptPackage.resolvedTemplateId ?? null,
        revisionId: promptPackage.resolvedTemplateRevisionId ?? null,
        hash: promptPackage.resolvedTemplateHash ?? null,
        versionLabel: promptPackage.resolvedTemplateVersionLabel ?? null,
        status: promptPackage.resolvedTemplateStatus ?? null,
        updatedAt: promptPackage.resolvedTemplateUpdatedAt
          ? promptPackage.resolvedTemplateUpdatedAt.toISOString()
          : null,
      },
      current: {
        templateId: promptPackage.resolvedTemplateId ?? null,
        revisionId: currentTemplate?.id ?? null,
        hash: currentTemplate?.contentHash ?? null,
        versionLabel: currentTemplate?.versionLabel ?? null,
        status: currentTemplate?.status ?? null,
        updatedAt: currentTemplate?.createdAt ? currentTemplate.createdAt.toISOString() : null,
      },
      drift: templateDrift,
    },
    memory: {
      studentMemorySnapshotId: promptPackage.studentMemorySnapshotId ?? null,
      studentMemorySnapshotHash: promptPackage.studentMemorySnapshotHash ?? null,
      selectedLessonMemoryIds: promptPackage.selectedLessonMemoryIds ?? [],
      selectedHomeworkMemoryIds: promptPackage.selectedHomeworkMemoryIds ?? [],
      retrievalPolicyVersion: promptPackage.retrievalPolicyVersion ?? null,
      layerAvailability: getPromptPackageMemoryLayerAvailability(promptPackage),
    },
  };
}

async function detectPromptPackageProfileDrift(
  promptPackage: PromptPackageRecord,
  getLatestRevision: (profileId: string) => Promise<ProfileRevisionRecord | null>,
): Promise<PromptPackageProfileDrift | null> {
  const studentId = promptPackage.studentId;
  const resolvedProfileHash = promptPackage.resolvedProfileHash;
  if (!studentId || !resolvedProfileHash) {
    return null;
  }

  const currentRevision = await getLatestRevision(studentId);
  if (!currentRevision) {
    return {
      detected: true,
      reason: 'profile_missing',
      currentProfileHash: null,
      currentProfileRevisionId: null,
      currentProfileUpdatedAt: null,
    };
  }

  const currentProfileHash = hashPromptProfileContent(currentRevision);
  if (currentProfileHash === resolvedProfileHash) {
    return null;
  }

  return {
    detected: true,
    reason: 'profile_content_changed',
    currentProfileHash,
    currentProfileRevisionId: currentRevision.id,
    currentProfileUpdatedAt: currentRevision.createdAt.toISOString(),
  };
}

async function detectPromptPackageTemplateDrift(
  promptPackage: PromptPackageRecord,
  getLatestRevision: (templateId: string) => Promise<TemplateRevisionRecord | null>,
): Promise<PromptPackageTemplateDrift | null> {
  const resolvedTemplateId = promptPackage.resolvedTemplateId;
  const resolvedTemplateHash = promptPackage.resolvedTemplateHash;
  if (!resolvedTemplateId || !resolvedTemplateHash) {
    return null;
  }

  const currentRevision = await getLatestRevision(resolvedTemplateId);
  if (!currentRevision) {
    return {
      detected: true,
      reason: 'template_missing',
      currentTemplateHash: null,
      currentTemplateRevisionId: null,
      currentTemplateUpdatedAt: null,
    };
  }

  if (currentRevision.contentHash === resolvedTemplateHash) {
    return null;
  }

  return {
    detected: true,
    reason: 'template_content_changed',
    currentTemplateHash: currentRevision.contentHash,
    currentTemplateRevisionId: currentRevision.id,
    currentTemplateUpdatedAt: currentRevision.createdAt.toISOString(),
  };
}
