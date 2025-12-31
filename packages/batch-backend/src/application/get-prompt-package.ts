import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { toPromptPackageResponse, type PromptPackageResponse } from './create-prompt-package.js';

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

  const storage = overrides?.storage ?? createTranscriptionStorage();
  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackageById,
  };

  const promptPackage = await promptPackages.getById(promptPackageId);
  if (!promptPackage) return null;

  const text = await storage.getText(promptPackage.storageUri);
  return toPromptPackageResponse(promptPackage, text);
}
