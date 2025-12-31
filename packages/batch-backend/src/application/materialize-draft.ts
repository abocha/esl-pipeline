import fs from 'node:fs/promises';
import path from 'node:path';

import { getDraftById } from '../domain/draft-repository.js';
import { updateJobDraftLink } from '../domain/job-repository.js';
import { createStorageConfigService } from '../infrastructure/storage-config.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';

export interface MaterializeDraftParams {
  draftId: string;
  jobId: string;
}

export interface MaterializeDraftResponse {
  draftId: string;
  jobId: string;
  mdPath: string;
}

export interface MaterializeDraftDependencies {
  storage: TranscriptionStorage;
  drafts: {
    getById: typeof getDraftById;
  };
  jobs: {
    updateDraftLink: typeof updateJobDraftLink;
  };
  uploadDir: string;
}

export async function materializeDraft(
  params: MaterializeDraftParams,
  overrides?: Partial<MaterializeDraftDependencies>,
): Promise<MaterializeDraftResponse | null> {
  if (!params.draftId || !params.jobId) return null;

  const storage = overrides?.storage ?? createTranscriptionStorage();
  const drafts = overrides?.drafts ?? {
    getById: getDraftById,
  };
  const jobs = overrides?.jobs ?? {
    updateDraftLink: updateJobDraftLink,
  };
  const uploadDir =
    overrides?.uploadDir ?? createStorageConfigService().getFilesystemConfig().uploadDir;

  const draft = await drafts.getById(params.draftId);
  if (!draft) return null;

  const text = await storage.getText(draft.storageUri);
  const mdPath = resolveDraftMaterializePath(uploadDir, draft.id);

  await fs.mkdir(path.dirname(mdPath), { recursive: true });
  await fs.writeFile(mdPath, text, 'utf8');

  const updated = await jobs.updateDraftLink({
    id: params.jobId,
    expectedState: 'awaiting_approval',
    md: mdPath,
    draftId: draft.id,
  });

  if (!updated) return null;

  return {
    draftId: draft.id,
    jobId: params.jobId,
    mdPath,
  };
}

function resolveDraftMaterializePath(uploadDir: string, draftId: string): string {
  const baseDir = path.resolve(uploadDir);
  const safeId = path.basename(draftId);
  const filename = `${safeId}.md`;
  const target = path.resolve(baseDir, 'drafts', filename);

  if (!isWithinBaseDir(baseDir, target)) {
    throw new Error('Draft materialization path resolves outside upload dir');
  }

  return target;
}

function isWithinBaseDir(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
