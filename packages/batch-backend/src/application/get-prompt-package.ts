import {
  getActiveProfileRevision,
} from '../domain/profile-revision-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import type { ProfileRevisionRecord } from '../domain/profile-revision-model.js';
import type { TemplateRevisionRecord } from '../domain/template-revision-model.js';
import { getActiveTemplateRevision } from '../domain/template-revision-repository.js';
import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import { type PromptPackageResponse, toPromptPackageResponse } from './create-prompt-package.js';

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

async function detectPromptPackageProfileDrift(
  promptPackage: PromptPackageRecord,
  getLatestRevision: (profileId: string) => Promise<ProfileRevisionRecord | null>,
): Promise<PromptPackageProfileDrift | null> {
  const resolvedProfileId = promptPackage.resolvedProfileId;
  const resolvedProfileHash = promptPackage.resolvedProfileHash;
  if (!resolvedProfileId || !resolvedProfileHash) {
    return null;
  }

  const currentRevision = await getLatestRevision(resolvedProfileId);
  if (!currentRevision) {
    return {
      detected: true,
      reason: 'profile_missing',
      currentProfileHash: null,
      currentProfileRevisionId: null,
      currentProfileUpdatedAt: null,
    };
  }

  if (currentRevision.contentHash === resolvedProfileHash) {
    return null;
  }

  return {
    detected: true,
    reason: 'profile_content_changed',
    currentProfileHash: currentRevision.contentHash,
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
