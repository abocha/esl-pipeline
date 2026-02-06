import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import { type PromptPackageResponse, toPromptPackageResponse } from './create-prompt-package.js';

export interface GetPromptPackageDependencies {
  storage: TranscriptionStorage;
  promptPackages: {
    getById: typeof getPromptPackageById;
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

  const promptPackage = await promptPackages.getById(promptPackageId);
  if (!promptPackage) return null;

  const storage = overrides?.storage ?? createTranscriptionStorageForUri(promptPackage.storageUri);
  const text = await storage.getText(promptPackage.storageUri);
  return toPromptPackageResponse(promptPackage, text);
}
