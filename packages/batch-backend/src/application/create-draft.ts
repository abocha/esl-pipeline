import { randomUUID } from 'node:crypto';

import type { DraftRecord } from '../domain/draft-model.js';
import { insertDraft } from '../domain/draft-repository.js';
import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';

export interface CreateDraftParams {
  promptPackageId: string;
  text: string;
  createdBy?: string | null;
}

export interface DraftResponse {
  id: string;
  promptPackageId: string;
  studentId: string | null;
  lessonId: string | null;
  storageUri: string;
  workingVersion: number | null;
  contentHash: string | null;
  createdBy: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDraftDependencies {
  storage: TranscriptionStorage;
  promptPackages: {
    getById: typeof getPromptPackageById;
  };
  drafts: {
    insert: typeof insertDraft;
  };
}

export async function createDraft(
  params: CreateDraftParams,
  overrides?: Partial<CreateDraftDependencies>,
): Promise<DraftResponse | null> {
  if (!params.promptPackageId || !params.text) return null;

  const storage = overrides?.storage ?? createTranscriptionStorage();
  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackageById,
  };
  const drafts = overrides?.drafts ?? {
    insert: insertDraft,
  };

  const promptPackage = await promptPackages.getById(params.promptPackageId);
  if (!promptPackage) return null;

  const draftId = randomUUID();
  const stored = await storage.putDraft({
    draftId,
    text: params.text,
  });

  const draft = await drafts.insert({
    id: draftId,
    promptPackageId: promptPackage.id,
    studentId: promptPackage.studentId ?? null,
    lessonId: promptPackage.lessonId ?? null,
    storageUri: stored.uri,
    workingVersion: 1,
    contentHash: stored.sha256,
    createdBy: params.createdBy ?? null,
  });

  return toDraftResponse(draft, params.text);
}

export function toDraftResponse(draft: DraftRecord, text: string): DraftResponse {
  return {
    id: draft.id,
    promptPackageId: draft.promptPackageId,
    studentId: draft.studentId ?? null,
    lessonId: draft.lessonId ?? null,
    storageUri: draft.storageUri,
    workingVersion: draft.workingVersion,
    contentHash: draft.contentHash,
    createdBy: draft.createdBy ?? null,
    text,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}
