import fs from 'node:fs/promises';
import path from 'node:path';

import type { JobConfigOverrides } from '@esl-pipeline/contracts';

import { createApprovalJobFromDraft } from './create-approval-job.js';
import { getDraftById } from '../domain/draft-repository.js';
import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import { approveJob, updateJobDraftLink } from '../domain/job-repository.js';
import { createStorageConfigService } from '../infrastructure/storage-config.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';

export interface MaterializeDraftParams {
  draftId: string;
  jobId?: string;
  jobOverrides?: JobConfigOverrides;
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
  promptPackages: {
    getById: typeof getPromptPackageById;
  };
  createApprovalJob: typeof createApprovalJobFromDraft;
  jobs: {
    updateDraftLink: typeof updateJobDraftLink;
    approveJob?: typeof approveJob;
  };
  uploadDir: string;
}

export async function materializeDraft(
  params: MaterializeDraftParams,
  overrides?: Partial<MaterializeDraftDependencies>,
): Promise<MaterializeDraftResponse | null> {
  if (!params.draftId) return null;

  const drafts = overrides?.drafts ?? {
    getById: getDraftById,
  };
  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackageById,
  };
  const createApprovalJob = overrides?.createApprovalJob ?? createApprovalJobFromDraft;
  const jobs = overrides?.jobs ?? {
    updateDraftLink: updateJobDraftLink,
  };
  const uploadDir =
    overrides?.uploadDir ?? createStorageConfigService().getFilesystemConfig().uploadDir;

  let resolvedJobId = params.jobId?.trim() || '';

  const draft = await drafts.getById(params.draftId);
  if (!draft) return null;

  const storage = overrides?.storage ?? createTranscriptionStorageForUri(draft.storageUri);

  if (!resolvedJobId) {
    const promptPackage = await promptPackages.getById(draft.promptPackageId);
    if (!promptPackage) return null;
    const approvalJob = await createApprovalJob({
      draft,
      promptPackage,
      jobOverrides: params.jobOverrides,
    });
    resolvedJobId = approvalJob.id;
  }

  const text = await storage.getText(draft.storageUri);
  const mdPath = resolveDraftMaterializePath(uploadDir, draft.id);

  await fs.mkdir(path.dirname(mdPath), { recursive: true });
  await fs.writeFile(mdPath, text, 'utf8');

  const updated = await jobs.updateDraftLink({
    id: resolvedJobId,
    expectedState: 'awaiting_approval',
    md: mdPath,
    draftId: draft.id,
  });

  if (!updated) return null;

  if (params.jobOverrides?.autoPublish) {
    const notifyApprove = overrides?.jobs?.approveJob ?? approveJob;
    await notifyApprove({
      id: resolvedJobId,
      expectedState: 'awaiting_approval',
      md: mdPath,
    });
  }

  return {
    draftId: draft.id,
    jobId: resolvedJobId,
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
